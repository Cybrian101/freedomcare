"use client";
import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
const stored = () => (window as unknown as { __fcInstall?: InstallEvent }).__fcInstall ?? null;

/**
 * Install FreedomCare on the phone's home screen. An installed app opens full screen, keeps its stored data safer from
 * being cleared, and starts faster with no signal. Chrome/Edge/Android show an Install button; iPhone needs the Share menu.
 */
export function InstallPrompt() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const sync = () => setEvt(stored());
    const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    // state is set from a microtask so the effect body itself stays free of synchronous updates
    void Promise.resolve().then(() => {
      setStandalone(!!isStandalone);
      setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
      sync();
    });
    window.addEventListener("fc:install", sync);
    const done = () => setStandalone(true);
    window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("fc:install", sync); window.removeEventListener("appinstalled", done); };
  }, []);

  if (standalone) {
    return <Card className="!p-4"><p className="font-bold text-ok-fg">Installed on this phone</p><p className="text-sm text-ink-muted">Opens full screen from the home screen and works with no signal once the checks above are green.</p></Card>;
  }
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-bold text-ink">Install on this phone</h2>
      <p className="text-sm text-ink-muted">Recommended. It opens full screen from the home screen, starts faster, and the app and its saved work are kept safer on the phone.</p>
      {evt ? (
        <Button full onClick={() => void evt.prompt().then(() => evt.userChoice).then(() => setEvt(null))}>Install FreedomCare</Button>
      ) : ios ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
          <li>Open this page in <b>Safari</b>.</li>
          <li>Tap the <b>Share</b> button (square with an arrow).</li>
          <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
        </ol>
      ) : (
        <p className="text-sm text-ink">Open the browser menu (&#8942;) and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>
      )}
    </Card>
  );
}
