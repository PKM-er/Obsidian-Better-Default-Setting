import {
	Plugin,
	setIcon,
	SettingTab,
	Setting,
	PluginManifest,
	ExtraButtonComponent,
	App,
	Modal,
	Notice,
	normalizePath
} from 'obsidian';
import {around} from "monkey-around";

declare module "obsidian" {
	interface App {
		internalPlugins: {
			plugins: Record<string,
				{ _loaded: boolean; instance: { name: string; id: string } }>;
		};
		plugins: {
			manifests: Record<string, PluginManifest>;
			plugins: Record<string, Plugin>;
		};
		setting: {
			activeTab: SettingTab;
			lastTabId: string;

			pluginTabs: PluginSettingTab[];
			settingTabs: SettingTab[];

			tabContentContainer: HTMLDivElement;
			tabHeadersEl: HTMLDivElement;
		};
		customCss: any;
		showInFolder(path: string): void;
		openWithDefaultApp(path: string): void;
	}

	interface Plugin {
		_loaded: boolean;
	}

	interface PluginSettingTab {
		name: string;
	}

	interface SettingTab {
		id: string;
		name: string;
		navEl: HTMLElement;
	}
}

export interface BetterDefaultSettingPluginSettings {
	filter: boolean;
}

export const DEFAULT_SETTINGS: BetterDefaultSettingPluginSettings = {
	filter: false,
}

export default class BetterDefaultSettingPlugin extends Plugin {
	settings: BetterDefaultSettingPluginSettings;
	private applyDebounceTimer = 0;

	async onload() {
		await this.loadSettings();

		app.workspace.onLayoutReady(this.onLayoutReadyForAppearance.bind(this));
		app.workspace.onLayoutReady(this.onLayoutReadyForPlugin.bind(this));
	}

	onunload() {

	}

	public applySettingsUpdate() {
		clearTimeout(this.applyDebounceTimer);
		this.applyDebounceTimer = window.setTimeout(async () => {
			await this.saveSettings();
		}, 100);
	}

	onLayoutReadyForAppearance(): void {
		const addButton = (container: HTMLElement) => {
			const reloadSnippetsElement = container.querySelector('[aria-label="Reload snippets"]') as HTMLButtonElement;
			if(!reloadSnippetsElement) return;
			const btn = reloadSnippetsElement?.parentElement?.createEl("button");
			if(!btn) return;
			btn.className = "btn btn-tertiary";
			setIcon(btn, "plus");
			btn.onclick = () => {
				new SnippetCreatorModal(app, ()=>{
					reloadSnippetsElement.click();
				}).open();
			}
		}
		const hideCssSnippetsElements = (element: HTMLDivElement) => {
			const headings = element.querySelectorAll('.setting-item.setting-item-heading') as NodeListOf<HTMLDivElement>;
			const lastHeading = headings[headings.length - 1];
			let sibling = lastHeading.nextElementSibling as HTMLDivElement;

			while (sibling) {
				if (sibling.classList.contains('mod-toggle') && !sibling.classList.contains('css-creator')) {
					sibling.style.display = 'none';
				}
				sibling = sibling.nextElementSibling as HTMLDivElement;
			}
		}

		const updateSetting = (setting: Setting, snippet: string, enabled: boolean, display: ()=>{}) => {
			setting.setName(snippet as string).setDesc("Apply CSS snippet at " + "vault/".concat(app.customCss.getSnippetPath(snippet as string))).addExtraButton((t)=>{
				t.setIcon('folder').onClick(async () => {
					const path = app.customCss.getSnippetPath(snippet);
					const normalizedPath = normalizePath(path);
					const checkExist = await app.vault.adapter.exists(normalizedPath);
					if(checkExist){
						app.showInFolder(path);
					}
				})
			}).addExtraButton((t)=>{
				t.setIcon('settings').onClick(async () => {
					const path = app.customCss.getSnippetPath(snippet);
					const normalizedPath = normalizePath(path);
					const checkExist = await app.vault.adapter.exists(normalizedPath);
					if (checkExist) {
						app.openWithDefaultApp(path);
					}
				})
			}).addToggle(((t) => {
					return t.setValue(enabled).onChange(((l) => {
							app.customCss.setCssEnabledStatus(snippet, l);
							display();
						}
					))
				}
			))
		}

		const addEnabledSnippets = (container: HTMLElement, display: ()=>{}) => {
			const enabledHeading = new Setting(container).setHeading().setName("Enabled CSS Snippets");
			enabledHeading.settingEl.classList.add('css-creator');
			const enabledSnippets = Array.from(app.customCss.enabledSnippets);
			const allSnippets = app.customCss.snippets;
			enabledSnippets.forEach((snippet: string) => {
				const setting = new Setting(container);
				setting.settingEl.classList.add('css-creator');
				updateSetting(setting, snippet, true, display);
			});

			const disabledHeading = new Setting(container).setHeading().setName("Disabled CSS Snippets");
			disabledHeading.settingEl.classList.add('css-creator');
			const disabledSnippets = allSnippets.filter((snippet: string) => !enabledSnippets.includes(snippet));
			if(disabledSnippets.length === 0) return;
			disabledSnippets.forEach((snippet: string) => {
				const setting = new Setting(container);
				setting.settingEl.classList.add('css-creator');
				updateSetting(setting, snippet, false, display);
			});

		}

		// Capture Hotkey events
		const appearance = this.getSettingsTab("appearance");
		if (appearance) this.register(around(appearance, { display: this.addPluginSettingEvents.bind(this, appearance.id) }));
		const appearanceTab = this.getSettingsTab("appearance") as SettingTab;

		if (appearanceTab) {
			this.register(around(appearanceTab, {
				display(old) {
					return function () {
						old.call(this);
						addButton(this.containerEl);
						hideCssSnippetsElements(this.containerEl);
						addEnabledSnippets(this.containerEl, this.display.bind(this));
					};
				},
			}));
		}
	}

	onLayoutReadyForPlugin(): void {

		const updatePlugins = (container: HTMLElement) => {
			const plugins = container.querySelectorAll('.installed-plugins-container .setting-item.mod-toggle');

			plugins.forEach((plugin: HTMLElement) => {
				const isEnabled = plugin.querySelector('.checkbox-container.is-enabled') === null;

				if (this.settings.filter) {
					if (!isEnabled) {
						plugin.style.display = 'none';
					}
				} else {
					plugin.style.display = '';
				}
			});

		}

		const addFilter = (container: HTMLElement, display: ()=>void) => {
			const heading = container.querySelector('.setting-item.setting-item-heading .setting-item-control') as HTMLDivElement;

			if (!heading) return;

			// Create a checkbox to filter out Plugins that are not enabled
			const btnComponent = new ExtraButtonComponent(heading).setIcon(this.settings.filter ? 'eye-off' : 'eye' ).onClick(() => {
				this.settings.filter = !this.settings.filter;
				this.applySettingsUpdate();

				updatePlugins(container);

				btnComponent.setIcon(this.settings.filter ? 'eye-off' : 'eye');
			}).setTooltip('Filter out disabled plugins');

			updatePlugins(container);
		};


		const plugins = this.getSettingsTab("community-plugins");
		if (plugins) this.register(around(plugins, { display: this.addPluginSettingEvents.bind(this, plugins.id) }));
		const pluginsTab = this.getSettingsTab("community-plugins") as SettingTab;

		if (pluginsTab) {
			this.register(around(pluginsTab, {
				display(old) {
					return function () {
						old.call(this);
						addFilter(this.containerEl, this.display.bind(this));
					};
				},
			}));
		}
	}

	getSettingsTab(id: string) {

		return app.setting.settingTabs.filter(t => t.id === id).shift() as SettingTab & { name: string };
	}

	addPluginSettingEvents(tabId: string, old: SettingTab["display"]) {
		const app = this.app;
		let in_event = false;

		function trigger(name: string, ...args: any[]) {
			in_event = true;
			try {
				app.workspace.trigger(name, ...args);
			} catch (e) {
				console.error(e);
			}
			in_event = false;
		}

		// Wrapper to add plugin-settings events
		return function display(...args: any[]) {
			if (in_event) return;
			trigger("plugin-settings:before-display", this, tabId);

			// Track which plugin each setting is for
			const remove = around(Setting.prototype, {
				addExtraButton(old) {
					return function (cb) {
						return old.call(this, function (b: ExtraButtonComponent) {
							cb(b);
						});
					}
				}
			});

			try {
				return old.apply(this, args);
			} finally {
				remove();
				trigger("plugin-settings:after-display", this);
			}
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SnippetCreatorModal extends Modal {
	cb: ()=> void;
	constructor(app: App, cb: ()=> void) {
		super(app);
		this.cb = cb;
	}

	onOpen() {
		const {contentEl} = this;
		const headerEl = contentEl.createEl('div', {cls: 'css-creator modal-header'});
		headerEl.createEl("h2", {text: "Snippet Creator", cls: "css-creator-title"});
		headerEl.createEl("p", {text: "Create a new snippet;", cls: "css-creator-description"});
		headerEl.createEl("p", {text: "File name cannot contain any of the following characters: * \" \\ / < > : | ?", cls: "css-creator-description"});
		headerEl.createEl("p", {text: "Don't add duplicate name to file", cls: "css-creator-description"});
		const inputGroupEl = contentEl.createEl('div', {cls: 'css-creator modal-body'});
		const inputEl = inputGroupEl.createEl('input', {placeholder: "Input file name here", cls:"css-creator-input"});
		const textareaEl = inputGroupEl.createEl('textarea', {placeholder: "Paste snippet here", cls:"css-creator-textarea"});

		const footerEl = contentEl.createEl('div', {cls: 'css-creator modal-footer'});
		const cancelBtnEl = footerEl.createEl('button', {text: "Cancel", cls: "css-creator-cancel"});
		const createBtnEl = footerEl.createEl('button', {text: "Create", cls: "css-creator-create"});

		cancelBtnEl.addEventListener('click', () => {
			this.close();
		});
		createBtnEl.addEventListener('click', () => {
			const fileName = inputEl.value;
			const snippet = textareaEl.value;
			if(!(fileName.trim()) || !(snippet.trim())) {
				new Notice("Please fill in all fields");
				return;
			}

			this.close();
			const filePath = normalizePath(app.customCss.getSnippetsFolder()) + "\\" + fileName.trim() + ".css";
			console.log(filePath);
			app.vault.adapter.write(filePath, snippet);
			new Notice("Snippet created successfully");
		});
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
		this.cb();
	}
}
