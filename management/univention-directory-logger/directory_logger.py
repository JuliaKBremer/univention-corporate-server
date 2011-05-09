# -*- coding: utf-8 -*-
#
# Univention Directory Listener
#  listener script for directory transaction logging
#
# Copyright 2004-2011 Univention GmbH
#
# http://www.univention.de/
#
# All rights reserved.
#
# The source code of this program is made available
# under the terms of the GNU Affero General Public License version 3
# (GNU AGPL V3) as published by the Free Software Foundation.
#
# Binary versions of this program provided by Univention to you as
# well as other copyrighted, protected or trademarked materials like
# Logos, graphics, fonts, specific documentations and configurations,
# cryptographic keys etc. are subject to a license agreement between
# you and Univention and not subject to the GNU AGPL V3.
#
# In the case you use this program under the terms of the GNU AGPL V3,
# the program is provided in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public
# License with the Debian GNU/Linux or Univention distribution in file
# /usr/share/common-licenses/AGPL-3; if not, see
# <http://www.gnu.org/licenses/>.

import listener
import string
import time
import syslog
import re
import md5
import base64
import grp
import subprocess
import os
import fcntl

import univention.debug
import univention.misc
#import univention.utf8

name='directory_logger'
description='Log directory transactions'
filter='(objectClass=*)' # log all objects by default
attributes=[]

logname='/var/log/univention/directory-logger.log'
registrySection='ldap/logging'
excludeKeyPattern=re.compile('%s/exclude\d+' % registrySection)
dellogKey='%s/dellogdir' % registrySection
cachename='/var/lib/univention-directory-logger/cache'
notifier_id='/var/lib/univention-directory-listener/notifier_id'
#notifier_id='/var/lib/univention-directory-listener/notifier_id'

headerfmt='''START\nOld Hash: %s\nDN: %s\nID: %s\nModifier: %s\nTimestamp: %s\nAction: %s\n'''
newtag='\nNew values:\n'
oldtag='\nOld values:\n'
endtag='END\n'
logmsgfmt='''DN=%s\nID=%s\nModifier=%s\nTimestamp=%s\nNew Hash=%s\n'''
timestampfmt='''%d.%m.%Y %H:%M:%S'''
uidNumber=0
preferedGroup="adm"
gidNumber=0		# fallback
filemode='0640'
cleanupDellog=True	# remove missed dellog entries (after reporting about them)

def needsConversion ( char ):
	return(char > '\x7f')

def base64Filter( str ):
	if [ char for char in str if needsConversion( char ) ]:
		str=string.rstrip(base64.encodestring(str))
	return str

def ldapEntry2string(entry):
	str=''
	for (key, valuelist) in entry.iteritems():
		str += ''.join( [ '%s: %s\n' % (key, base64Filter(value)) for value in valuelist ] )
	return str

def ldapTime2string( timestamp ):
	try:
		timestruct = time.strptime(timestamp, "%Y%m%d%H%M%SZ")
	except ValueError:
		univention.debug.debug(univention.debug.LISTENER, univention.debug.ERROR, '%s: could not parse timestamp %s, expected LDAP format' % (name, timestamp) )
		return timestamp	# return it as it was
	return time.strftime(timestampfmt, timestruct)

def filterOutUnchangedAttributes(old, new):
	keylist = old.keys()
	for key in keylist:
		if not new.has_key(key):
			continue
		if new[key] == old[key]:
			del old[key]
			del new[key]
			continue
		removelist=[]
		for value in old[key]:
			for value2 in new[key]:
				if value == value2:
					removelist.append(value)
					continue
		for value in removelist:
			old[key].remove(value)
			new[key].remove(value)

def process_dellog( dn ):
	dellog = listener.baseConfig[dellogKey]
	lockfilename = dellog + '.lock'
	lock = open(lockfilename, "w")
	fcntl.flock( lock, fcntl.LOCK_EX )
	try: 
		dellist = os.listdir(dellog);
		dellist.sort();
		filename = dellist.pop(0);
		filename = os.path.join(dellog, filename);
		f = open(filename)
		(dellog_stamp, dellog_id, dellog_dn, dellog_bindDN, dellog_action) = [line.rstrip() for line in f]
		f.close()
		if dellog_dn != dn:

			# first clean up the mess:
			leftover=1
			if cleanupDellog:
				os.unlink(filename)

			# be nice: see if we can find dn in a later entry
			for filename in dellist:
				filename = os.path.join(dellog, filename)
				f = open(filename)
				(dellog_stamp, dellog_id, dellog_dn, dellog_bindDN, dellog_action) = [line.rstrip() for line in f]
				f.close()
				if dellog_dn == dn:
					univention.debug.debug(univention.debug.LISTENER, univention.debug.WARN, '%s: dn found in dellog entry %s, ID %s (+%s)' % (name, filename, dellog_id, leftover) )
					break
				# damn, missed that one as well. Now it's too late, clean up:
				leftover+=1
				if cleanupDellog:
					os.unlink(filename)

		if dellog_dn == dn:	# haben wir's jetzt?
			timestamp = ldapTime2string(dellog_stamp)
			modifier = dellog_bindDN
			action = dellog_action
			os.unlink(filename)
		else:
			univention.debug.debug(univention.debug.LISTENER, univention.debug.ERROR, '%s: dn not found in dellog: %s' % (name,dn) )

	finally:
		fcntl.flock ( lock, fcntl.LOCK_UN )
		os.unlink(lockfilename)

	if not modifier:	# Fallback
		timestamp = time.strftime(timestampfmt, time.gmtime() )
		dellog_id = '<NoID>'
		modifier = '<unknown>'
		action = '<unknown>'

	return (timestamp, dellog_id, modifier, action)


def handler(dn, new, old):

	if listener.baseConfig[registrySection] != 'yes':
		return

	# check for exclusion
	skip = 0
	excludeKeys = [ key for key in listener.baseConfig.keys() if excludeKeyPattern.search(key)]
	exclude = [ listener.baseConfig[key] for key in excludeKeys ]
	for base in exclude:
		if dn.rfind(base) != -1:
			skip = 1

	listener.setuid(0)
	try:
		if skip == 1:
			if not new:	# there should be a dellog entry to remove
				process_dellog( dn )
			return		# important: don't return a thing, otherwise this dn
					# seems to get excluded from future processing by this module

		## Start processing
		# 1. read previous hash
		if not os.path.exists( cachename ):
			univention.debug.debug(univention.debug.LISTENER, univention.debug.ERROR, '%s: %s vanished mid-run, stop.' % (name, cachename) )
			return				# really bad, stop it.
		cachefile = open(cachename, 'r+')
		previoushash = cachefile.read()

		# get ID
		f = open(notifier_id, 'r')	
		id = int(f.read()) + 1	# matches notifier transaction id. Tested for UCS 1.3-2 and 2.0.
					# Note about 1.3-2:
					# For user removal this matches with ++last_id as seen by the dellog overlay,
					# but for user create dellog sees id-1, i.e. last_id has already been incremented before
					# we see it here
		f.close()

		# 2. generate log record
		if new:
			modifier = new['modifiersName'][0]
			timestamp = ldapTime2string( new['modifyTimestamp'][0] )

			if not old:	# create branch
				record = headerfmt % (previoushash, dn, id, modifier, timestamp, 'add')
				record += newtag
				record += ldapEntry2string(new)

			else:		# modify branch
				# filter out unchanged attibutes
				filterOutUnchangedAttributes(old, new)
				record = headerfmt % (previoushash, dn, id, modifier, timestamp, 'modify')
				record += oldtag
				record += ldapEntry2string(old)
				record += newtag
				record += ldapEntry2string(new)

		else:			# delete branch
			(timestamp, dellog_id, modifier, action) = process_dellog( dn )

			#if dellog_id != str(id) and (dellog_id != '<NoID>'):	# Sanity check
			#	univention.debug.debug(univention.debug.LISTENER, univention.debug.WARN, '%s: id out of sync with dellog: %s vs %s' % (name,id,dellog_id) )
			# Note about 1.3-2:
			# For user removal id matches with dellog_id as seen by the dellog overlay,
			# but for user create dellog sees id-1, i.e. last_id has already been incremented before
			# we see it here. Tested for UCS 1.3-2 and 2.0.

			record = headerfmt % (previoushash, dn, id, modifier, timestamp, 'delete')
			record += oldtag
			record += ldapEntry2string(old)

		# 3. write log file record
		record += endtag
		try:
			logfile = open(logname, 'a')			# append
			logfile.write( record )
		finally:
			logfile.close()
		# 4. calculate nexthash, omitting the final line break to make validation of the
		#    record more intituive
		nexthash = md5.new(record[:-1]).hexdigest()
		# 5. cache nexthash (the actual logfile might be logrotated away..)
		cachefile.seek(0)
		cachefile.write(nexthash)
		cachefile.close()
		# 6. send log message including nexthash
		syslog.openlog(name, 0, syslog.LOG_DAEMON)
		syslog.syslog(syslog.LOG_INFO, logmsgfmt % (dn, id, modifier, timestamp, nexthash) )
		syslog.closelog()
	finally:
		listener.unsetuid()

def createFile(filename, withdirs=False ):
	global uidNumber
	global gidNumber
	global preferedGroup

	if gidNumber == 0:
		try:
			gidNumber = int(grp.getgrnam( preferedGroup )[2])
		except:
			univention.debug.debug(univention.debug.LISTENER, univention.debug.WARN, '%s: Failed to get groupID for "%s"' % (name, preferedGroup) )
			gidNumber = 0

	basedir = os.path.dirname(filename)
	if not os.path.exists( basedir ):
		os.makedirs( basedir )

	returncode = subprocess.call(["/bin/touch", "%s" % filename ])
	if not os.path.exists( filename ):
		univention.debug.debug(univention.debug.LISTENER, univention.debug.ERROR, '%s: %s could not be created.' % (name, filename) )
		return 1
	os.chown(filename, uidNumber, gidNumber)
	os.chmod(filename, int(filemode, 0))
	return 0
	
def initialize():
	timestamp = time.strftime(timestampfmt, time.gmtime() )
	univention.debug.debug(univention.debug.LISTENER, univention.debug.INFO, 'init %s' % name)

	if not os.path.exists( logname ):
		createFile( logname )

	listener.setuid(0)
	try:
		if not os.path.exists( cachename ):
			createFile( cachename )
		size = os.path.getsize(cachename)
		cachefile = open(cachename, 'r+')

		# generate log record
		if size == 0:
			action= 'Initialize'
			record = 'START\nTimestamp: %s\nAction: %s %s\n' % (timestamp, action, name)
		else:
			# read previous hash
			previoushash = cachefile.read()
			action= 'Reinitialize'
			record = 'START\nOld Hash: %s\nTimestamp: %s\nAction: %s %s\n' % (previoushash, timestamp, action, name)
		record += endtag

		# 3. write log file record
		try:
			logfile = open(logname, 'a')			# append
			logfile.write(record)
		finally:
			logfile.close()

		# 4. calculate initial hash
		nexthash = md5.new(record).hexdigest()
		# 5. cache nexthash (the actual logfile might be logrotated away..)
		cachefile.seek(0)
		cachefile.write(nexthash)
		cachefile.close()
		# 6. send log message including nexthash
		syslog.openlog(name, 0, syslog.LOG_DAEMON)
		syslog.syslog(syslog.LOG_INFO, '%s\nTimestamp=%s\nNew Hash=%s' % (action, timestamp, nexthash) )
		syslog.closelog()
	finally:
		listener.unsetuid()

def clean():
	# don't remove the cache.
	pass

##--- initialize on load:
if not os.path.exists( logname ):
	createFile( logname )
if not os.path.exists( cachename ):
	univention.debug.debug(univention.debug.LISTENER, univention.debug.WARN, '%s: %s vanished, creating it' % (name, cachename) )
	listener.setuid(0)
	try:
		createFile( cachename )
	finally:
		listener.unsetuid()

