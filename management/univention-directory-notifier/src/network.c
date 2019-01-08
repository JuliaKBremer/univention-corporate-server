/*
 * Univention Directory Notifier
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

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <univention/debug.h>

#include "cache.h"
#include "callback.h"
#include "network.h"
#include "notify.h"

static NetworkClient_t *network_client_first = NULL;
static int server_socketfd_listener;
fd_set readfds;

int network_create_socket(int port) {
	int server_socketfd;
	struct sockaddr_in6 server_address;
	int i;

	server_socketfd = socket(PF_INET6, SOCK_STREAM, 0);

	i = 1;
	setsockopt(server_socketfd, SOL_SOCKET, SO_REUSEADDR, &i, sizeof(i));

	server_address.sin6_family = AF_INET6;
	server_address.sin6_addr = in6addr_any;
	server_address.sin6_port = htons(port);

	if (bind(server_socketfd, (struct sockaddr *)&server_address, sizeof(server_address)) == -1) {
		univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_WARN, "bind cannot connect via AF_INET6, trying AF_INET");
		close(server_socketfd);
		struct sockaddr_in server_address;
		server_socketfd = socket(PF_INET, SOCK_STREAM, 0);
		i = 1;
		setsockopt(server_socketfd, SOL_SOCKET, SO_REUSEADDR, &i, sizeof(i));
		server_address.sin_family = AF_INET;
		server_address.sin_addr.s_addr = htonl(INADDR_ANY);
		server_address.sin_port = htons(port);
		if (bind(server_socketfd, (struct sockaddr *)&server_address, sizeof(server_address)) == -1) {
			perror("bind");
			univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ERROR, "bind failed with AF_INET6 and also with AF_INET, exit");
			exit(1);
		}
	}

	if (listen(server_socketfd, 5) == -1) {
		perror("listen");
		univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ERROR, "listen failed, exit");
		exit(1);
	}

	return server_socketfd;
}

int network_client_add(int fd, callback_handler handler, int notify) {
	NetworkClient_t *tmp;

		tmp = malloc(sizeof(NetworkClient_t));
		tmp->fd = fd;
		tmp->handler = handler;
		tmp->notify = notify;
		tmp->next_id = 0;
		tmp->next = network_client_first;

		network_client_first = tmp;

	return 0;
}

int network_client_del(int fd) {
	NetworkClient_t **tmp;

	shutdown(fd, 2);

	for (tmp = &network_client_first; *tmp != NULL; tmp = &((*tmp)->next))
		if ((*tmp)->fd == fd) {
			NetworkClient_t *found = *tmp;
			*tmp = (*tmp)->next;
			free(found);
			break;
		}

	return 0;
}

int network_client_set_next_id(int fd, unsigned long id) {
	NetworkClient_t *tmp = network_client_first;

	while (tmp != NULL) {
		if (tmp->fd == fd) {
			univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "Set next ID for fd %d to %ld\n", fd, id);
			tmp->next_id = id;
			tmp->notify = 1;
			break;
		}
		tmp = tmp->next;
	}

	return 0;
}

int network_client_set_msg_id(int fd, unsigned long msg_id) {
	NetworkClient_t *tmp = network_client_first;

	while (tmp != NULL) {
		if (tmp->fd == fd) {
			univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "Set msg ID for fd %d to %ld\n", fd, msg_id);
			tmp->msg_id = msg_id;
			break;
		}
		tmp = tmp->next;
	}

	return 0;
}

int network_client_set_version(int fd, int version) {
	NetworkClient_t *tmp = network_client_first;

	while (tmp != NULL) {
		if (tmp->fd == fd) {
			univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "Set version for fd %d to %d\n", fd, version);
			tmp->version = version;
			break;
		}
		tmp = tmp->next;
	}

	return 0;
}

int network_client_get_version(int fd) {
	NetworkClient_t *tmp = network_client_first;

	while (tmp != NULL) {
		if (tmp->fd == fd) {
			return tmp->version;
		}
		tmp = tmp->next;
	}

	return -1;
}

static int new_connection(int fd, callback_remove_handler remove) {
	struct sockaddr_in client_address;
	int client_socketfd;
	socklen_t client_l;

	client_l = sizeof(client_address);

	if ((client_socketfd = accept(fd, (struct sockaddr *)&client_address, &client_l)) == -1) {
		return 1;
	}

	FD_SET(client_socketfd, &readfds);

	network_client_add(client_socketfd, data_on_connection, 0);

	return 0;
}

int network_client_init(int port) {
	server_socketfd_listener = network_create_socket(6669);
	network_client_add(server_socketfd_listener, new_connection, 0);

	return 0;
}

int network_client_main_loop(callback_check check_callbacks) {
	NetworkClient_t *client;
	fd_set testfds;

	univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_INFO, "Starting main loop\n");
	/* create listener socket */

	FD_ZERO(&readfds);
	FD_SET(server_socketfd_listener, &readfds);

	/* main loop */
	while (1) {
		testfds = readfds;
		if (select(FD_SETSIZE, &testfds, NULL, NULL, NULL) < 1) {
			/*FIXME */
			if (errno == EINTR || errno == 29) {
				/* Ignore signal */
				check_callbacks();
				continue;
			}
			univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ERROR, "select() error: %s. exit", strerror(errno));
			exit(1);
		}

		for (client = network_client_first; client != NULL; client = client->next) {
			if (FD_ISSET(client->fd, &testfds)) {
				client->handler(client->fd, network_client_del);
				break;
			}
		}
		check_callbacks();
	}

	return 0;
}

int network_client_dump() {
	NetworkClient_t *tmp;

	univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "------------------------------\n");
	for (tmp = network_client_first; tmp != NULL; tmp = tmp->next) {
		univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "Listener fd = %d\n", tmp->fd);
	}
	univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "------------------------------\n");
	return 0;
}

int network_client_check_clients(unsigned long last_known_id) {
	NetworkClient_t *tmp;
	char string[NETWORK_MAX];

	for (tmp = network_client_first; tmp != NULL; tmp = tmp->next) {
		if (tmp->notify) {
			if (tmp->next_id <= last_known_id) {
				char *dn_string = NULL;

				univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "try to read %ld from cache", tmp->next_id);

				/* try to read from cache */
				if ((dn_string = notifier_cache_get(tmp->next_id)) == NULL) {
					univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "%ld not found in cache", tmp->next_id);

					univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "%ld get one dn", tmp->next_id);

					/* read from transaction file, because not in cache */
					if ((dn_string = notify_transcation_get_one_dn(tmp->next_id)) == NULL) {
						univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "%ld failed ", tmp->next_id);
						univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ERROR, "%d closed, read from transaction file failed ", tmp->fd);
						/* TODO: maybe close connection? */
					}
				}

				if (dn_string != NULL) {
					snprintf(string, sizeof(string), "MSGID: %ld\n%s\n\n", tmp->msg_id, dn_string);

					univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "--> %d: [%s]", tmp->fd, string);

					write(tmp->fd, string, strlen(string));

					free(dn_string);
				}
				tmp->notify = 0;
				tmp->msg_id = 0;
			}
		}
	}
	return 0;
}

int network_client_all_write(unsigned long id, char *buf, size_t l_buf) {
	NetworkClient_t *tmp;
	int rc;
	char string[NETWORK_MAX];

	if (l_buf == 0) {
		return 0;
	}

	univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "l=%ld, --> [%s]", l_buf, buf);

	for (tmp = network_client_first; tmp != NULL; tmp = tmp->next) {
		if (tmp->notify) {
			univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "Wrote to Listener fd = %d\n", tmp->fd);
			if (tmp->next_id == id) {
				memset(string, 0, NETWORK_MAX);
				snprintf(string, sizeof(string), "MSGID: %ld\n%.*s\n", tmp->msg_id, (int)l_buf, buf);
				univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "Wrote to Listener fd = %d[%s]\n", tmp->fd, string);
				rc = write(tmp->fd, string, strlen(string));
				// rc = write(tmp->fd, buf, l_buf );
				tmp->notify = 0;
				tmp->msg_id = 0;
			}
		} else {
			univention_debug(UV_DEBUG_TRANSFILE, UV_DEBUG_ALL, "Ignore Listener fd = %d\n", tmp->fd);
		}
	}

	return rc;
}
