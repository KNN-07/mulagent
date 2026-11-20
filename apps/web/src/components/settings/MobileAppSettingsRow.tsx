import { msg, T, useGT, useMessages, Var } from "gt-react";

import { MOBILE_APP_URL } from "../../branding";
import { AndroidIcon, AppleIcon } from "../Icons";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { QRCodeSvg } from "../ui/qr-code";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const platforms = [
  {
    label: msg("iPhone and iPad"),
    url: MOBILE_APP_URL.replace("#mobile-app", "#ios-mobile-client"),
    Icon: AppleIcon,
  },
  {
    label: "Android",
    url: MOBILE_APP_URL.replace("#mobile-app", "#android-mobile-client"),
    Icon: AndroidIcon,
  },
];

export function MobileAppSettingsRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  return (
    <SettingsRow
      {...searchableSetting("mobile-app")}
      description={gt("Connect to your server from your phone or tablet.")}
      control={
        <div className="flex items-center gap-2">
          {platforms.map(({ label, url, Icon }) => (
            <Popover key={url}>
              <PopoverTrigger render={<Button size="sm" variant="outline" />}>
                <Icon />
                {m(label)}
              </PopoverTrigger>
              <PopoverPopup align="end">
                <div className="flex flex-col items-center gap-3">
                  <PopoverTitle>{m(label)}</PopoverTitle>
                  <p className="text-xs text-muted-foreground">
                    <T>Scan with your phone camera.</T>
                  </p>
                  <div className="rounded-lg bg-white p-1.5">
                    <QRCodeSvg
                      value={url}
                      size={128}
                      level="M"
                      marginSize={1}
                      title={gt("{store} link", { store: m(label) })}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    render={<a href={url} target="_blank" rel="noreferrer noopener" />}
                  >
                    <T>
                      Open <Var>{m(label)}</Var>
                    </T>
                  </Button>
                </div>
              </PopoverPopup>
            </Popover>
          ))}
        </div>
      }
    />
  );
}
