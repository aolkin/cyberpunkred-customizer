import CPR from "/systems/cyberpunk-red-core/modules/system/config.js";

function deepCopy (obj) {
    if (typeof obj === "object") {
        if (Array.isArray(obj)) {
            return [...obj];
        } else {
            return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deepCopy(v)]));
        }
    } else {
        return obj;
    }
}

const BASE_SETTINGS = deepCopy(CPR);
CONFIG.CPR = CPR;

const MODULE_ID = 'cyberpunkred-customizer';
const ENABLE_SETTING = 'enableCustomizations';
const ENABLE_FULL_CONFIG = 'enableFullConfig';
const DATA_SETTING = 'customizationData';

const RECOMMENDED = [
    'clothingStyle',
    'clothingType',
    'ammoType',
    'ammoVariety',
    'weaponTypeList',
    'cyberwareTypeList',
    'itemPriceCategory',
    'itemPriceCategoryMap',
    'skillCategories',
    'skillCategoriesForWeapons',
]

/*
interface {
    customizations: Array<{
       group: string,
       key: string,
       value: string,
    }>;
}
*/

function _isOverrideableConfigObject(obj) {
    const firstKey = Object.keys(obj)[0];
    return typeof firstKey === 'string' && (typeof obj[firstKey] === 'string' || typeof obj[firstKey] === 'number');
}

class CustomizationMenuApplication extends FormApplication {
    constructor() {
        super();
        this.data = game.settings.get(MODULE_ID, DATA_SETTING);
        this.data.customizations = (this.data.customizations || []).map(c => ({
            ...c,
            existing: true,
            removing: false,
        }));
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            closeOnSubmit: false,
            template: `modules/${MODULE_ID}/templates/menu.hbs`,
            id: `${MODULE_ID}-menu`,
            title: 'Cyberpunk RED System Customizations',
            width: 750,
            height: 'auto',
            resizable: true,
        });
    }

    getData() {
        const enableAll = game.settings.get(MODULE_ID, ENABLE_FULL_CONFIG);
        const groups = Object.keys(CPR)
                .filter(key =>
                    // Filter to properties that are effectively Record<string, string>
                    typeof CPR[key] === 'object' && _isOverrideableConfigObject(CPR[key]))
                .filter(key => !RECOMMENDED.includes(key)
                    && (enableAll || this.data.customizations.some(c => c.group === key)));
        return {
            recommendedGroups: Object.fromEntries(RECOMMENDED.map(i => ([i, i]))),
            groups: Object.fromEntries(groups.map(i => ([i, i]))),
            showOtherGroups: groups.length > 0,
            customizations: [...this.data.customizations, {}],
        };
    }

    async _updateObject(event, rawFormData) {
        const action = event.submitter?.name;
        const formData = foundry.utils.expandObject(rawFormData);
        for (const [key, value] of Object.entries(formData.changes)) {
            const current = this.data.customizations[key];
            const existing = current?.existing ?? false;
            const sanitized = {
                group: existing ? current.group : value.group,
                key: existing ? current.key : value.key.trim(),
                value: value.value.trim(),
                existing,
                removing: value.remove,
            };
            const numeric = Number.parseInt(sanitized.value);
            if (!Number.isNaN(numeric)) {
                sanitized.value = numeric;
            }
            this.data.customizations[key] = sanitized;
        }
        switch (action) {
            case "add":
                this.render();
                break;
            case "save":
                const data = {
                    ...this.data,
                    customizations: this.data.customizations
                        .filter(c => c.key && c.value && !c.removing)
                        .map(c => ({ group: c.group, key: c.key, value: c.value }))
                }
                await game.settings.set(MODULE_ID, DATA_SETTING, data);
                game.socket.emit("reload");
                debouncedReload();
                this.close();
                break;
        }
    }

    activateListeners(html) {
        super.activateListeners(html);
        let valuesAreExpanded = 0;
        const spacer = html[0].querySelector('.spacer');

        html[0].querySelectorAll('div.customizer-row').forEach(row => {
            const currentValueContainer = row.querySelector('.current-values');
            const currentValues = currentValueContainer.querySelector(".current-value-list");

            row.querySelector('.row-key-input').addEventListener("change", (event) => {
               const value = event.target.value;
               row.querySelector('.key-format-warning').style.display =
                   value.match(/^[a-zA-Z0-9]*$/) ? 'none' : 'block';
            })

            const group = row.querySelector('select');
            function renderCurrentData () {
                currentValueContainer.querySelector('.group-name').innerText = group.value;
                [...currentValues.children].forEach(entry => entry.remove());
                const currentData = BASE_SETTINGS[group.value];
                Object.entries(currentData).forEach(([key, value]) => {
                    const keyEl = document.createElement("code");
                    keyEl.innerText = key;
                    const valueEl = document.createElement("span");
                    valueEl.innerText = typeof value === 'string' ? game.i18n.localize(value) : value;
                    const entry = document.createElement("li");
                    entry.append(keyEl, valueEl);
                    currentValues.appendChild(entry);
                });
            }
            group.addEventListener('change', renderCurrentData);
            renderCurrentData();

            const updateVisibility = () => {
                currentValueContainer.style.display = rowIsFocused > 0 ? "block": "none";
                spacer.style.display = valuesAreExpanded > 0 ? "none" : "block";
                this.setPosition({
                    ...this.position,
                    height: 'auto',
                })
            }

            let rowIsFocused = 0;
            row.querySelectorAll('input:not([type=checkbox]),select').forEach(el => {
                el.addEventListener('focus', () => {
                    rowIsFocused++;
                    valuesAreExpanded++;
                    updateVisibility();
                });
                el.addEventListener('blur', () => {
                    rowIsFocused--;
                    valuesAreExpanded--;
                    updateVisibility();
                });
            });

            const removeCheckbox = row.querySelector('input[type=checkbox]')
            function updateRemovalWarning() {
                row.querySelector('.removal-warning').style.display = removeCheckbox.checked ? 'block' : 'none';
            }
            removeCheckbox.addEventListener('change', () => {
                updateRemovalWarning()
                updateVisibility();
            });
            updateRemovalWarning();
        })
    }
}

async function loadCustomizations(data) {
    data.customizations?.forEach(customization => {
        CPR[customization.group][customization.key] = customization.value;
    })
}

Hooks.once('init', async function() {
    await game.settings.register(MODULE_ID, ENABLE_SETTING, {
        name: 'Enable Customizations',
        hint: 'Enable or disable all configured customizations.',
        scope: 'world',
        config: true,
        requiresReload: true,
        restricted: true,
        type: Boolean,
        default: true,
        onChange: (value) => {
            console.debug(`Changed ${MODULE_ID}.${ENABLE_SETTING} to ${value}`);
        },
    });

    await game.settings.register(MODULE_ID, ENABLE_FULL_CONFIG, {
        name: 'Allow All Configuration Sets',
        hint: 'Advanced Users Only: Enable modifying *any* configuration set, not just the recommended sets. ' +
            'Only enable this if you are sure you know what you are doing, and remember to take backups!',
        scope: 'world',
        config: true,
        requiresReload: false,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: (value) => {
            console.debug(`Changed ${MODULE_ID}.${ENABLE_FULL_CONFIG} to ${value}`);
        },
    });

    await game.settings.register(MODULE_ID, DATA_SETTING, {
        config: false, // managed by the menu below
        scope: 'world',
        requiresReload: true,
        restricted: true,
        type: Object,
        default: {},
        onChange: (value) => {
            console.debug(`Changed ${MODULE_ID}.${DATA_SETTING} to ${JSON.stringify(value)}`);
        },
    });

    await game.settings.registerMenu(MODULE_ID, 'customizationMenu', {
        name: 'Customizations',
        hint: 'Configure system customizations and overrides.',
        label: 'Customization Configuration',
        icon: 'fas fas-cog',
        type: CustomizationMenuApplication,
    });

    if (game.settings.get(MODULE_ID, ENABLE_SETTING)) {
        console.info('Loading customizations for Cyberpunk RED...');
        await loadCustomizations(game.settings.get(MODULE_ID, DATA_SETTING));
        ui.notifications.info('Loaded system customizations...');
    } else {
        console.warn('System customizations for Cyberpunk RED are disabled.');
    }
});
