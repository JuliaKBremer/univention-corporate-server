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
/*global define */

define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/query",
	"dojo/dom-class",
	"dojo/dom-style",
	"dojo/dom-construct",
	"dijit/Destroyable",
	"umc/tools",
	"umc/widgets/Tooltip",
	"umc/widgets/ContainerWidget",
	"dgrid/List",
	"dgrid/extensions/DijitRegistry",
	"put-selector/put",
	"umc/i18n!umc/app"
], function(declare, lang, array, query, domClass, domStyle, domConstruct, Destroyable,
		tools, Tooltip, ContainerWidget, List, DijitRegistry, put, _) {
	return declare("umc.widgets.GalleryPane", [ List, DijitRegistry, Destroyable ], {
		style: "",

		baseClass: 'umcGalleryPane',

		bounceDuration: 150,

		query: {},

		queryOptions: {},

		_setStore: function(value) {
			this.store = value;
			this._renderQuery();
		},

		_setQuery: function(value) {
			this.query = value;
			this._renderQuery();
		},

		_setQueryOptions: function(value) {
			this.queryOptions = value;
			this._renderQuery();
		},

		_renderQuery: function() {
			this.refresh();
			this.renderArray(this.store.query(this.query, this.queryOptions));
		},

		postCreate: function() {
			this.inherited(arguments);

			// TODO: this changes with Dojo 2.0
			this.domNode.setAttribute("widgetId", this.id);

			// add specific DOM classes
			if (this.baseClass) {
				domClass.add(this.domNode, this.baseClass);
			}

			// add specific CSS style given as string
			if (lang.isObject(this.style)){
				domStyle.set(this.domNode, this.style);
			}
			else {
				if (this.domNode.style.cssText){
					this.domNode.style.cssText += "; " + this.style;
				}
				else {
					this.domNode.style.cssText = this.style;
				}
			}

			// set the store
			if (this.store) {
				this.set('store', this.store);
			}
		},

		startup: function() {
			this.inherited(arguments);
			if (this.store) {
				this._renderQuery();
			}
		},

		isLeftToRight: function() {
			// needed for Dojo 1.9
			return true;
		},

		getItemDescription: function(item) {
			return item.description || '';
		},

		renderRow: function(item, options) {
			// create gallery item
			var div = put(lang.replace('div.umcGalleryItem[moduleID={moduleID}]', {
				moduleID: item.$id$
			}));
			var description = this.getItemDescription(item);
			put(div, 'div.umcGalleryIcon.' + this.getIconClass(item));
			put(div, 'div.umcGalleryName', item.name || '');
			put(div, 'div.umcGalleryDescription', description);

			// create status icon
			var statusIconClass = this.getStatusIconClass(item);
			if (typeof statusIconClass === 'string') {
				var statusIconDiv = domConstruct.create('div', {'class': 'umcGalleryStatusIcon ' + statusIconClass}, div);
				var statusIconLabel = this.getStatusIconTooltip(item);
				if (statusIconLabel) {
					var statusIconTooltip = new Tooltip({
						label: statusIconLabel,
						connectId: [ statusIconDiv ]
					});
					this.own(statusIconTooltip);
				}
			}

			return div;
		},

		getIconClass: function(item) {
			if (item.icon) {
				return tools.getIconClass(item.icon, 50);
			}
			return '';
		},

		getStatusIconClass: function(item) {
			return '';
		},

		getStatusIconTooltip: function(item) {
			return '';
		}
	});
});

