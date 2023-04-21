import {Plugin, setIcon, SettingTab, Setting, PluginManifest, ExtraButtonComponent, App, Modal, Notice} from 'obsidian';
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

export default class MyPlugin extends Plugin {

	async onload() {
		app.workspace.onLayoutReady(this.onLayoutReady.bind(this));

	}

	onunload() {

	}

	onLayoutReady(): void {
		// Capture Hotkey events
		const appearance = this.getSettingsTab("appearance");
		if (appearance) this.register(around(appearance, { display: this.addPluginSettingEvents.bind(this, appearance.id) }));
		const appearanceTab = this.getSettingsTab("appearance") as SettingTab;
		console.log(appearanceTab);
		if (appearanceTab) {
			this.register(around(appearanceTab, {
				display(old) {
					return function () {
						old.call(this);
						const reloadSnippetsElement = this.containerEl.querySelector('[aria-label="Reload snippets"]');
						const btn = reloadSnippetsElement.parentElement.createEl("button");
						btn.className = "btn btn-tertiary";
						setIcon(btn, "plus");
						btn.onclick = () => {
							new SnippetCreatorModal(app, ()=>{
								reloadSnippetsElement.click();
							}).open();
						}
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
}

class SnippetCreatorModal extends Modal {
	cb: ()=>{};
	constructor(app: App, cb: ()=>{}) {
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

			// const basePath = app.vault.adapter.getBasePath();
			const cssSnippetRelativePath = ".obsidian\\snippets\\";
			const fileName = inputEl.value;
			const snippet = textareaEl.value;
			if(!(fileName.trim()) || !(snippet.trim())) {
				new Notice("Please fill in all fields");
				return;
			}

			this.close();
			const filePath = cssSnippetRelativePath + fileName + ".css";
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
