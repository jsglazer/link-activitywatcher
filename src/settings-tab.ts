import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS, HEARTBEAT_MAX, HEARTBEAT_MIN, IDLE_MAX, parsePatterns, type WatcherSettings } from "./core/settings";
import type LinkActivityWatcherPlugin from "./main";

export class LinkActivityWatcherSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: LinkActivityWatcherPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		new Setting(containerEl).setName("Connection").setHeading();

		let resultEl: HTMLElement | null = null;
		const server = new Setting(containerEl)
			.setName("Server URL")
			.setDesc("Address of your local aw-server. The default port is 5600; the ActivityWatch testing server uses 5666.")
			.addText((text) => {
				text.setPlaceholder(DEFAULT_SETTINGS.serverUrl).setValue(s.serverUrl);
				// Apply on blur/Enter, not per keystroke, so typing does not trigger a reconnect per character.
				text.inputEl.addEventListener("change", () => {
					void this.apply({ serverUrl: text.getValue() }).then(() => text.setValue(this.plugin.settings.serverUrl));
				});
			})
			.addButton((button) =>
				button.setButtonText("Test connection").onClick(async () => {
					if (!resultEl) return;
					resultEl.setText("Testing…");
					resultEl.removeClass("mod-success", "mod-warning");
					try {
						resultEl.setText(await this.plugin.testConnection(this.plugin.settings.serverUrl));
						resultEl.addClass("mod-success");
					} catch (e) {
						resultEl.setText(e instanceof Error ? e.message : String(e));
						resultEl.addClass("mod-warning");
					}
				}),
			);
		resultEl = server.descEl.createDiv({ cls: "link-activitywatcher-test-result" });

		new Setting(containerEl).setName("Tracking").setHeading();

		new Setting(containerEl)
			.setName("Pause tracking")
			.setDesc("Stop sending anything to ActivityWatch. Also available from the status bar and the command palette.")
			.addToggle((t) => t.setValue(s.paused).onChange((v) => this.apply({ paused: v })));

		new Setting(containerEl)
			.setName("Heartbeat interval (seconds)")
			.setDesc(`How often the open note is reported while you are active (${HEARTBEAT_MIN}–${HEARTBEAT_MAX}). Switching notes is reported immediately.`)
			.addSlider((sl) =>
				sl
					.setLimits(HEARTBEAT_MIN, HEARTBEAT_MAX, 1)
					.setValue(s.heartbeatSeconds)
					.setDynamicTooltip()
					.onChange((v) => this.apply({ heartbeatSeconds: v })),
			);

		new Setting(containerEl)
			.setName("Only while Obsidian is focused")
			.setDesc("Stop reporting when another app is in front.")
			.addToggle((t) => t.setValue(s.focusOnly).onChange((v) => this.apply({ focusOnly: v })));

		new Setting(containerEl)
			.setName("Idle timeout (minutes)")
			.setDesc(`Stop reporting after this long without keyboard or mouse input in Obsidian. 0 keeps reporting while a note is open, e.g. when reading without scrolling. Max ${IDLE_MAX}.`)
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text.inputEl.max = String(IDLE_MAX);
				text.setValue(String(s.idleMinutes)).onChange((v) => {
					if (v.trim() !== "") void this.apply({ idleMinutes: Number(v) });
				});
			});

		new Setting(containerEl)
			.setName("Record file events")
			.setDesc("Log note create, rename, and delete events to a separate bucket (aw-watcher-obsidian-fileevents_<host>). Events that happen while ActivityWatch is offline are sent when it comes back.")
			.addToggle((t) => t.setValue(s.trackFileEvents).onChange((v) => this.apply({ trackFileEvents: v })));

		new Setting(containerEl).setName("Privacy").setHeading();

		new Setting(containerEl)
			.setName("Excluded paths")
			.setDesc(
				"One glob per line, matched against the vault-relative path. Folder/ excludes a whole folder, *.excalidraw.md matches in any folder, Journal/**/private-* spans subfolders. Lines starting with # are ignored. Matching notes are never sent.",
			)
			.setClass("link-activitywatcher-patterns")
			.addTextArea((ta) => {
				ta.setPlaceholder("Private/\n*.secret.md").setValue(s.excludePatterns.join("\n"));
				ta.inputEl.rows = 5;
				ta.inputEl.addEventListener("change", () => void this.apply({ excludePatterns: parsePatterns(ta.getValue()) }));
			});

		new Setting(containerEl)
			.setName("Send vault folder path")
			.setDesc("Include the vault's absolute folder path (projectPath) in each event. The vault name is always sent.")
			.addToggle((t) => t.setValue(s.sendVaultPath).onChange((v) => this.apply({ sendVaultPath: v })));
	}

	private apply(patch: Partial<WatcherSettings>): Promise<void> {
		return this.plugin.updateSettings(patch);
	}
}
