/*
 * Copyright 2014 Univention GmbH
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
/*global define*/

define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"umc/tools",
	"umc/widgets/Module",
	"./adconnector/SetupWizard",
	"./adconnector/ConfigPage",
	"umc/i18n!umc/modules/adconnector"
], function(declare, lang, array, tools, Module, SetupWizard, ConfigPage, _) {
	return declare("umc.modules.adconnector", Module, {

		standbyOpacity: 1.00,

		wizard: null,

		configPage: null,

		buildRendering: function() {
			this.inherited(arguments);
			this.standbyDuring(tools.umcpCommand('adconnector/state')).then(lang.hitch(this, function(response) {
				var state = response.result;
				if (!state.configured) {
					this.wizard = new SetupWizard({});
					this.addChild(this.wizard);
					this.wizard.on('Finished', lang.hitch(this, function() {
							topic.publish('/umc/tabs/close', this);
					}));
					this.wizard.on('Cancel', lang.hitch(this, function() {
							topic.publish('/umc/tabs/close', this);
					}));
				}
				else {
					this.configPage = new ConfigPage({
						initialState: state
					});
					this.addChild(this.configPage);
				}
			}));
		}
	});
});
