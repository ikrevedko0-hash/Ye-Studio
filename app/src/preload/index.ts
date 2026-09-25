import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type { Api, FetchProgress, ProgressInfo, SearchChunk, SearchStart, UpdateStatus } from "../shared/api";
import type { InstallProgress } from "../core/components/manifest";

const api: Api = {
  newPack: () => ipcRenderer.invoke("pack:new"),
  openPack: (path) => ipcRenderer.invoke("pack:open", path),
  savePack: (pkg, saveAs) => ipcRenderer.invoke("pack:save", pkg, saveAs),
  draftWrite: (pkg) => ipcRenderer.invoke("draft:write", pkg),
  draftInfo: () => ipcRenderer.invoke("draft:info"),
  draftRestore: () => ipcRenderer.invoke("draft:restore"),
  draftDiscard: () => ipcRenderer.invoke("draft:discard"),
  openBackups: () => ipcRenderer.invoke("backups:open"),
  openInSigame: (packPath) => ipcRenderer.invoke("sigame:open", packPath),
  pickTargetPack: (path) => ipcRenderer.invoke("theme:pickPack", path),
  transferTheme: (theme, to) => ipcRenderer.invoke("theme:transfer", theme, to),
  addMedia: (paths) => ipcRenderer.invoke("media:add", paths),
  removeMedia: (folder, name) => ipcRenderer.invoke("media:remove", folder, name),
  reveal: (path) => ipcRenderer.invoke("shell:reveal", path),
  clipboardText: () => ipcRenderer.invoke("clipboard:text"),
  clipboardWrite: (text) => ipcRenderer.invoke("clipboard:write", text),
  setDirty: (dirty) => ipcRenderer.send("pack:dirty", dirty),
  openPath: (path) => ipcRenderer.invoke("shell:open", path),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onSelfTestLoad: (cb) => ipcRenderer.on("selftest:load", (_e, d) => cb(d)),
  ffmpegAvailable: () => ipcRenderer.invoke("ffmpeg:available"),
  probeSystem: () => ipcRenderer.invoke("system:probe"),
  componentsState: () => ipcRenderer.invoke("components:state"),
  installModel: (profile) => ipcRenderer.invoke("components:install", profile),
  cancelModelInstall: () => ipcRenderer.invoke("components:cancel"),
  adoptModelFolder: () => ipcRenderer.invoke("components:adopt"),
  removeModel: () => ipcRenderer.invoke("components:remove"),
  installTool: (tool) => ipcRenderer.invoke("components:installTool", tool),
  removeTool: (tool) => ipcRenderer.invoke("components:removeTool", tool),
  updateTool: (tool) => ipcRenderer.invoke("components:updateTool", tool),
  firstRun: () => ipcRenderer.invoke("firstRun:get"),
  firstRunDone: () => ipcRenderer.invoke("firstRun:done"),
  assistantStatus: () => ipcRenderer.invoke("assistant:status"),
  assistantPickDir: (current) => ipcRenderer.invoke("assistant:pickDir", current),
  assistantSetup: (kind, workdir) => ipcRenderer.invoke("assistant:setup", kind, workdir),
  assistantDone: () => ipcRenderer.invoke("assistant:done"),
  assistantOpen: (target) => ipcRenderer.invoke("assistant:open", target),
  onComponentsProgress: (cb) => {
    const h = (_e: IpcRendererEvent, p: InstallProgress) => cb(p);
    ipcRenderer.on("components:progress", h);
    return () => { ipcRenderer.off("components:progress", h); };
  },
  probeMedia: (folder, name) => ipcRenderer.invoke("media:probe", folder, name),
  waveform: (folder, name, points) => ipcRenderer.invoke("media:waveform", folder, name, points),
  grabFrame: (folder, name, timeSec) => ipcRenderer.invoke("media:frame", folder, name, timeSec),
  editMedia: (req) => ipcRenderer.invoke("media:edit", req),
  saveImage: (dataUrl, suggestedName) => ipcRenderer.invoke("image:save", dataUrl, suggestedName),
  mediaBytes: (folder, name) => ipcRenderer.invoke("media:bytes", folder, name),
  cancelEdit: () => ipcRenderer.invoke("media:cancel"),
  // Настройки окна приходят синхронно: они нужны в первом же кадре, до всякой отрисовки.
  ui: ipcRenderer.sendSync("ui:all") as { editorWidth?: number; ytMaxHeight?: number; theme?: string; reportErrors?: boolean },
  setUi: (key, value) => ipcRenderer.invoke("ui:set", key, value),
  mediaProviders: () => ipcRenderer.invoke("media:providers"),
  diagnoseYoutube: () => ipcRenderer.invoke("media:diagnose"),
  mediaRoute: () => ipcRenderer.invoke("media:route"),
  cookiesStatus: () => ipcRenderer.invoke("media:cookies"),
  cookiesImport: () => ipcRenderer.invoke("media:cookiesImport"),
  cookiesLogin: () => ipcRenderer.invoke("media:cookiesLogin"),
  cookiesRefresh: () => ipcRenderer.invoke("media:cookiesRefresh"),
  cookiesLogout: () => ipcRenderer.invoke("media:cookiesLogout"),
  onYtLogin: (cb) => {
    const h = () => cb();
    ipcRenderer.on("yt:login", h);
    return () => { ipcRenderer.off("yt:login", h); };
  },
  watchSideBySide: (url) => ipcRenderer.invoke("shell:watchSideBySide", url),
  mediaSearch: (q, only) => ipcRenderer.invoke("media:search", q, only),
  mediaSearchCancel: () => ipcRenderer.invoke("media:searchCancel"),
  mediaFetch: (r, toPack, want) => ipcRenderer.invoke("media:fetch", r, toPack, want),
  mediaFetchCancel: () => ipcRenderer.invoke("media:fetchCancel"),
  mediaSources: () => ipcRenderer.invoke("media:sources"),
  libraryToPack: (files) => ipcRenderer.invoke("library:toPack", files),
  libraryReveal: (file) => ipcRenderer.invoke("library:reveal", file),
  libraryRemove: (file) => ipcRenderer.invoke("library:remove", file),
  libraryKeep: (folder, name, note) => ipcRenderer.invoke("library:keep", folder, name, note),
  wordGenerators: () => ipcRenderer.invoke("words:generators"),
  wordStats: () => ipcRenderer.invoke("words:stats"),
  wordRun: (id, args) => ipcRenderer.invoke("words:run", id, args),
  imagePresets: () => ipcRenderer.invoke("imagegen:presets"),
  phrases: () => ipcRenderer.invoke("phrases:get"),
  imagePresetSave: (id, text) => ipcRenderer.invoke("imagegen:savePrompt", id, text),
  imagePrompt: (phrase, preset, temperature) => ipcRenderer.invoke("imagegen:prompt", phrase, preset, temperature),
  imageGenerate: (prompt, width, height, allowPaid, style) => ipcRenderer.invoke("imagegen:run", prompt, width, height, allowPaid, style),
  imageStyles: () => ipcRenderer.invoke("imagegen:styles"),
  imageKeep: (dataUrl, phrase, info) => ipcRenderer.invoke("imagegen:keep", dataUrl, phrase, info),
  imageCancel: () => ipcRenderer.invoke("imagegen:cancel"),
  aiSettings: () => ipcRenderer.invoke("ai:settings"),
  aiSettingsSave: (s) => ipcRenderer.invoke("ai:settingsSave", s),
  aiTest: (id) => ipcRenderer.invoke("ai:test", id),
  aiTemplates: () => ipcRenderer.invoke("ai:templates"),
  aiQuota: (only) => ipcRenderer.invoke("ai:quota", only),
  onFetchProgress: (cb) => {
    const h = (_e: IpcRendererEvent, p: FetchProgress) => cb(p);
    ipcRenderer.on("media:fetchProgress", h);
    return () => { ipcRenderer.off("media:fetchProgress", h); };
  },
  onSearchChunk: (cb) => {
    const h = (_e: IpcRendererEvent, c: SearchChunk) => cb(c);
    ipcRenderer.on("media:searchChunk", h);
    return () => { ipcRenderer.off("media:searchChunk", h); };
  },
  onSearchStart: (cb) => {
    const h = (_e: IpcRendererEvent, s: SearchStart) => cb(s);
    ipcRenderer.on("media:searchStart", h);
    return () => { ipcRenderer.off("media:searchStart", h); };
  },
  onEditProgress: (cb) => {
    const h = (_e: IpcRendererEvent, p: ProgressInfo) => cb(p);
    ipcRenderer.on("media:progress", h);
    return () => { ipcRenderer.off("media:progress", h); };
  },
  publishFolder: (packPath, packName) => ipcRenderer.invoke("publish:folder", packPath, packName),
  publishPoster: (pkg, packPath, packName) => ipcRenderer.invoke("publish:poster", pkg, packPath, packName),
  publishOpenVk: () => ipcRenderer.invoke("publish:openVk"),

  // ---------- обновления ----------
  appVersion: () => ipcRenderer.invoke("app:version"),
  updateStatus: () => ipcRenderer.invoke("update:status"),
  updateCheck: () => ipcRenderer.invoke("update:check"),
  updateDownload: () => ipcRenderer.invoke("update:download"),
  updateInstall: () => ipcRenderer.invoke("update:install"),
  onUpdateState: (cb) => {
    const h = (_e: IpcRendererEvent, s: UpdateStatus) => cb(s);
    ipcRenderer.on("update:state", h);
    return () => { ipcRenderer.off("update:state", h); };
  },

  // ---------- связь с сервером автора ----------
  reportError: (err) => ipcRenderer.invoke("errors:report", err),
  feedbackCapture: () => ipcRenderer.invoke("feedback:capture"),
  feedbackSend: (req) => ipcRenderer.invoke("feedback:send", req),
};

contextBridge.exposeInMainWorld("api", api);
