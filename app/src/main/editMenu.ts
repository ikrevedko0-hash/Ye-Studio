// Меню правой кнопки «Вырезать / Копировать / Вставить». Electron сам его не показывает,
// поэтому вешаем на все окна сразу — и на главное, и на вспомогательные.

import { app, Menu, type MenuItemConstructorOptions } from "electron";

export function enableEditMenu(): void {
  app.on("web-contents-created", (_e, wc) => {
    wc.on("context-menu", (_ev, p) => {
      const hasText = p.selectionText.trim().length > 0;
      const items: MenuItemConstructorOptions[] = [];
      if (p.isEditable) {
        items.push(
          { label: "Вырезать", role: "cut", enabled: p.editFlags.canCut && hasText },
          { label: "Копировать", role: "copy", enabled: p.editFlags.canCopy && hasText },
          { label: "Вставить", role: "paste", enabled: p.editFlags.canPaste },
          { type: "separator" },
          { label: "Выделить всё", role: "selectAll" },
        );
      } else if (hasText) {
        items.push({ label: "Копировать", role: "copy" });
      }
      if (items.length) Menu.buildFromTemplate(items).popup();
    });
  });
}
