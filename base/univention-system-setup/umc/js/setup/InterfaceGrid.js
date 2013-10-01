/*
 * Copyright 2012-2013 Univention GmbH
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
/*global define console setTimeout*/

define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/store/Memory",
	"dojo/store/Observable",
	"dijit/Dialog",
	"umc/dialog",
	"umc/tools",
	"umc/widgets/Grid",
	"umc/widgets/_FormWidgetMixin",
	"umc/modules/setup/InterfaceWizard",
	"umc/modules/setup/Interfaces",
	"umc/modules/setup/types",
	"umc/i18n!umc/modules/setup"
], function(declare, lang, array, Memory, Observable, Dialog, dialog, tools, Grid, _FormWidgetMixin, InterfaceWizard, Interfaces, types, _) {
	return declare("umc.modules.setup.InterfaceGrid", [ Grid, _FormWidgetMixin ], {
		moduleStore: null,

		style: 'width: 100%; height: 225px;',
		query: {},
		sortIndex: 1,

		gateway: "",
		nameserver: [],

		constructor: function() {
			this.moduleStore = new Observable(new Interfaces({idProperty: 'name'}));

			lang.mixin(this, {
				columns: [{
					name: 'name',
					label: _('Network interface'),
					width: '18%'
				}, {
					name: 'interfaceType',
					label: _('Type'),
					width: '15%',
					formatter: function(value) {
						return types.interfaceTypeLabels[value] || value;
					}
				}, {
					name: 'configuration',
					label: _('Configuration'),
					formatter: lang.hitch(this, function(val, row, scope) {
						var iface = this.getRowValues(row);
						return this.moduleStore.getInterface(iface.name).getConfigurationDescription();
					}),
					width: '67%'
				}],
				actions: [{
					name: 'edit',
					label: _('Edit'),
					iconClass: 'umcIconEdit',
					isMultiAction: false,
					isStandardAction: true,
					isContextAction: true,
					callback: lang.hitch(this, '_editInterfaces')
				}, {
					name: 'add',
					label: _('Add interface'),
					iconClass: 'umcIconAdd',
					isMultiAction: false,
					isStandardAction: false,
					isContextAction: false,
					callback: lang.hitch(this, '_addInterface')
				}, {
					name: 'delete',
					label: _('Delete'),
					iconClass: 'umcIconDelete',
					isMultiAction: true,
					isStandardAction: true,
					callback: lang.hitch(this, function(ids) {
						dialog.confirm(_('Please confirm the removal of the %d selected interfaces!', ids.length), [{
							label: _('Delete'),
							callback: lang.hitch(this, '_removeInterfaces', ids)
						}, {
							label: _('Cancel'),
							'default': true
						}]);
					}),
					canExecute: lang.hitch(this, function(item) {
						if (!item.isVLAN()) {
							// interface is not removeable if used as parent device in a VLAN
							return array.every(this.get('value'), function(iface) {
								return !iface.isVLAN() || item.name !== iface.parent_device;
							});
						}
						return true;
					})
				}]
			});

			tools.ucr(['version/version']).then(lang.hitch(this, function(data) {
				this.ucsversion = data['version/version'];
			}));

		},

		_getValueAttr: function() {
			return this.moduleStore.query();
		},

		_setValueAttr: function(values) {
			// empty the grid
			var data = [];

			// set new values
			tools.forIn(values, function(iname, iface) {
				data.push(this.moduleStore.createDevice(iface));
			}, this);

			this.moduleStore.setData(data);

			this._cachedInterfaces = {};

			this._ready = false;
			array.forEach(this.moduleStore.query(), lang.hitch(this, function(iface) {
				this._consistence(iface, -1, 0);
			}));
			this._ready = true;
			this._disableUsedInterfaces();

			this.moduleStore.query().observe(lang.hitch(this, function(iface, removedFrom, insertedInto) {
				this._consistence(iface, removedFrom, insertedInto);
				setTimeout(lang.hitch(this, '_disableUsedInterfaces'), 250);
			}), true);

			setTimeout(lang.hitch(this._grid, '_refresh'), 0);

			this._set('value', this.get('value'));
		},

		_disableUsedInterfaces: function() {
			var to_disable = {};

			var items = this.get('value');
			array.forEach(items, function(iface) {
				if (!iface.isVLAN()) {
					array.forEach(iface.getSubdeviceNames(), function(name) {
						to_disable[name] = true;
					});
				}
			});

			array.forEach(items, lang.hitch(this, function(iface) {
				// enable and disable all items
				this.setDisabledItem(iface.name, true === to_disable[iface.name]);
			}));
		},

		_consistence: function(iface, removedFrom, insertedInto) {
			var create = removedFrom === -1;
			var deleted = insertedInto === -1;
			var key;
			iface = this.moduleStore.createDevice(iface);

			if (!deleted) {

				if (iface.isBond() || iface.isBridge()) {
					// store original subdevices
					array.forEach(iface.getSubdeviceNames(), lang.hitch(this, function(ikey) {
						var iiface = this.moduleStore.getInterface(ikey);
						if (iiface === undefined) {
							// the interface is not configured in the grid but exists as physical interface
							this.moduleStore.put(this.moduleStore.createDevice({name: ikey, interfaceType: 'Ethernet'}));
							return;
						}
						this._cachedInterfaces[iiface.name] = this.moduleStore.createDevice(iiface);

						if (this._ready) {
							iiface.ip4 = [];
							iiface.ip6 = [];
							iiface.ip4dynamic = false;
							iiface.ip6dynamic = false;
							setTimeout(lang.hitch(this, function() {
								this.moduleStore.put(iiface);
							}), 0);
						}
					}));
				}
			} else {

				// restore original values
				array.forEach(iface.getSubdeviceNames(), lang.hitch(this, function(ikey) {
					var iiface = this.moduleStore.getInterface(ikey);
					if (iiface === undefined) {
						return; // the interface is not configured in the grid
					}
					if (this._cachedInterfaces[iiface.name]) {
						setTimeout(lang.hitch(this, function() {
							this.moduleStore.put(this._cachedInterfaces[iiface.name]);
						}), 0);
					}
				}));
			}

			this._set('value', this.get('value'));
		},

		updateInterface: function(data) {
			var iface = this.moduleStore.createDevice(data.values);

			// set gateway if got from DHCP request
			if (data.gateway) {
				this.set('gateway', data.gateway);
			}

			// set nameservers if got from DHCP request
			if (data.nameserver && data.nameserver.length) {
				this.set('nameserver', data.nameserver);
			}

			var renamed = false;
			if (!data.creation) {
				renamed = iface.name != data.original_name;
				if (!renamed) {
					this.moduleStore.put(iface);
					return;
				}
			}
			try {
				this.moduleStore.add(iface);
			} catch(error) {
				console.log(error);
				dialog.alert(_('Interface "%s" already exists.', iface.name));
				return;
			}

			if (renamed) {
				// remove old interface after the new has been added
				setTimeout(lang.hitch(this, function() { this.moduleStore.remove(data.original_name); }), 0);
			}
		},

		_editInterfaces: function(name, devices) {
			// grid action
			this._showWizard(devices[0]);
		},

		_addInterface: function() {
			// grid action
			this._showWizard(null);
		},

		_removeInterfaces: function(ids) {
			// grid action
			array.forEach(ids, function(iid) {
				this.moduleStore.remove(iid);
			}, this);
			this._set('value', this.get('value'));
		},

		_showWizard: function(device) {
			// show an InterfaceWizard for the given device
			// and insert data into the grid when saving the new values
			var _dialog = null;

			var _cleanup = function() {
				_dialog.hide().then(lang.hitch(_dialog, 'destroyRecursive'));
			};

			var _finished = lang.hitch(this, function(values) {
				var data = {};
				data.gateway = values.gateway;
				data.nameserver = values.nameserver;
				data.creation = values.creation;
				data.values = values;
				data.original_name = values.original_name;
				this.updateInterface(data);
				_cleanup();
			});

			var wizard = new InterfaceWizard({
				interfaces: this.moduleStore,
				ucsversion: this.ucsversion,
				device: device,
				onCancel: _cleanup,
				onFinished: _finished
			});

			_dialog = new Dialog({
				title: device ? _('Edit a network interface') : _('Add a network interface'),
				content: wizard
			});
			_dialog.own(wizard);
			this.own(_dialog);
			_dialog.show();
		},

		onChange: function() {
			// event stub
		}
	});
});
