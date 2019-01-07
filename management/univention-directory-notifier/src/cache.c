/*
 * Univention Directory Notifier
 *  cache.c
 *
 * Copyright 2004-2019 Univention GmbH
 *
 * http://www.univention.de/
 *
 * All rights reserved.
 *
 * The source code of this program is made available
 * under the terms of the GNU Affero General Public License version 3
 * (GNU AGPL V3) as published by the Free Software Foundation.
 *
 * Binary versions of this program provided by Univention to you as
 * well as other copyrighted, protected or trademarked materials like
 * Logos, graphics, fonts, specific documentations and configurations,
 * cryptographic keys etc. are subject to a license agreement between
 * you and Univention and not subject to the GNU AGPL V3.
 *
 * In the case you use this program under the terms of the GNU AGPL V3,
 * the program is provided in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public
 * License with the Debian GNU/Linux or Univention distribution in file
 * /usr/share/common-licenses/AGPL-3; if not, see
 * <http://www.gnu.org/licenses/>.
 */
#define _GNU_SOURCE

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <univention/debug.h>

#include "cache.h"
#include "notify.h"

long long notifier_cache_size = 1000;

static notify_cache_t *cache;

/*
 * Return cache bucket for transaction id.
 * :param id: Tranbsaction ID.
 * :return: Cache entry.
 */
static inline notify_cache_t *lookup(unsigned long id) {
	return cache + id % notifier_cache_size;
}

int notifier_cache_init(unsigned long max_id) {
	unsigned long id;

	cache = calloc(notifier_cache_size, sizeof(notify_cache_t));

	id = max_id <= notifier_cache_size ? 1 : max_id - notifier_cache_size + 1;
	univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_INFO, "Loading cache %ld..%ld", id, max_id);
	for (; id <= max_id; id++) {
		char *p, *pp;
		notify_cache_t *entry = lookup(id);
		char *buffer = notify_transcation_get_one_dn(id);
		if (buffer == NULL) {
			univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_WARN, "Failed lookup: %ld", id);
			continue;
		}

		sscanf(buffer, "%ld", &(entry->id));
		entry->command = buffer[strlen(buffer) - 1];
		p = index(buffer, ' ') + 1;
		pp = rindex(p, ' ');
		entry->dn = strndup(p, pp - p);

		free(buffer);
	}

	return 0;
}

int notifier_cache_add(unsigned long id, char *dn, char cmd) {
	if (dn == NULL)
		return 0;

	notify_cache_t *entry = lookup(id);

	free(entry->dn);
	entry->id = id;
	entry->dn = strdup(dn);
	entry->command = cmd;

	return 0;
}

char *notifier_cache_get(unsigned long id) {
	char *str = NULL;
	notify_cache_t *entry = lookup(id);

	univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_PROCESS, "searching cache id = %ld", id);
	if (entry->id == id) {
		if (asprintf(&str, "%ld %s %c", entry->id, entry->dn, entry->command) < 0)
			abort();
	}

	univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_PROCESS, "cache[%ld] = [%s]", id, str ? str : "<NULL>");
	return str;
}
