import type { ComponentProps } from "react";

import iconUrl from "../../../../assets/icon.svg";

export function T3Wordmark(props: ComponentProps<"img">) {
  return <img {...props} src={iconUrl} alt="" />;
}
