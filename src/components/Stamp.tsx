// 签章:文字 + 边框表达状态,不依赖颜色;材质随皮肤 token。
// skin()/mode() 的读取全部放在 JSX 表达式里,皮肤切换即刷新。
import { Text, View, token } from "nsh";
import { skinStyle, toneColor } from "../theme";
import { mode, skin } from "../state";

type Tone = "default" | "success" | "warn" | "error" | "muted" | "primary";

function stampColor(tone: Tone): string {
  if (tone === "success") return toneColor(skin(), "success", mode());
  if (tone === "warn") return toneColor(skin(), "warn", mode());
  if (tone === "error") return toneColor(skin(), "error", mode());
  if (tone === "primary") return token("primary");
  return token("muted-foreground");
}

export function Stamp(props: { label: string; tone?: Tone }) {
  const tone = props.tone ?? "default";
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: stampColor(tone),
        borderRadius: skinStyle(skin()).radius,
        paddingHorizontal: 6,
        paddingVertical: 1,
        marginBottom: 2,
      }}
    >
      <Text style={{ color: stampColor(tone), fontSize: 11 }}>{props.label}</Text>
    </View>
  );
}
