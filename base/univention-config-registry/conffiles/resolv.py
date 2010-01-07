# -*- coding: utf-8 -*-
#
# Univention Configuration Registry
#  config registry module for the resolv.conf 
#
# Copyright (C) 2004-2010 Univention GmbH
#
# http://www.univention.de/
#
# All rights reserved.
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License version 2 as
# published by the Free Software Foundation.
#
# Binary versions of this file provided by Univention to you as
# well as other copyrighted, protected or trademarked materials like
# Logos, graphics, fonts, specific documentations and configurations,
# cryptographic keys etc. are subject to a license agreement between
# you and Univention.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software
# Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA

import os
import subprocess

def postinst(baseConfig, changes):
	if baseConfig.get( 'interfaces/handler', 'ifplugd' ) == 'networkmanager':
		return
	for key in baseConfig.keys():
		if key.startswith('interfaces/') and key.endswith('/type'):
			if baseConfig[key] == 'dhcp' and os.path.exists('/sbin/dhclient'):
				iface=key.split('/')[1]
				subprocess.call( [ 'ifdown', iface ] )
				subprocess.call( [ 'ifup', iface ] )


