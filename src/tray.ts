// 系统托盘:图标 + 右键菜单(刷新数据 / 退出)。仅桌面平台有效。
import { Tray } from "nsh/desktop";
import appIcon from "./assets/app-icon.png";
import { refresh } from "./state";

export function setupTray(): void {
  try {
    Tray.set({
      icon: appIcon,
      tooltip: "SkillMate",
      menu: [
        {
          label: "刷新数据",
          onSelect: () => void refresh(),
        },
        { type: "separator" },
        { label: "退出", role: "quit" },
      ],
    });
  } catch {
    // 托盘不可用(平台不支持)时静默跳过
  }
}
