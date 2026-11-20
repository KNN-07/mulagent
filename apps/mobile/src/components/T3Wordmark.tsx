import type { ColorValue } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedRect = withUniwind(Rect);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg height={props.height} width={props.height} viewBox="0 0 64 64" aria-hidden>
      <ThemedRect
        width="64"
        height="64"
        rx="14"
        fill={props.color ?? "#4f46e5"}
        colorClassName={props.colorClassName}
      />
      <Path d="M16 44V20h5l11 15 11-15h5v24h-5V28L32 43 21 28v16z" fill="white" />
    </Svg>
  );
}
