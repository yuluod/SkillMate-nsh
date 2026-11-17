// 一次性脚本:把 SkillMate 前端的扁平点分 locale 键转为 rust-i18n 嵌套 JSON,
// 并把 {name} 占位符换成 %{name}。源文件只读,输出写到本仓库 locales/。
import { writeFileSync, mkdirSync } from "node:fs";

const SOURCE = "C:/Users/luosh/IdeaProjects/SkillMate/src/locales";

function nest(flat) {
  const root = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (typeof node[parts[i]] !== "object" || node[parts[i]] === null) {
        node[parts[i]] = {};
      }
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = String(value).replace(/\{(\w+)\}/g, "%{$1}");
  }
  return root;
}

async function load(file) {
  return (await import(`file:///${file}`)).default;
}

const zhCN = nest(await load(`${SOURCE}/zh-CN.js`));
const en = nest(await load(`${SOURCE}/en.js`));

mkdirSync("locales", { recursive: true });
writeFileSync("locales/zh-CN.json", `${JSON.stringify(zhCN, null, 2)}\n`, "utf8");
writeFileSync("locales/en.json", `${JSON.stringify(en, null, 2)}\n`, "utf8");
console.log(`zh-CN: ${Object.keys(await load(`${SOURCE}/zh-CN.js`)).length} keys, en: ${
  Object.keys(await load(`${SOURCE}/en.js`)).length
} keys`);
