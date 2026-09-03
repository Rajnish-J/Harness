"use client";

import { Boxes, FlaskConical, Palette, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import AdvancedTab from "@/components/settings/AdvancedTab";
import AppearanceTab from "@/components/settings/AppearanceTab";
import GeneralTab from "@/components/settings/GeneralTab";
import ModelsTab from "@/components/settings/ModelsTab";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useStoredPreference } from "@/hooks/use-stored-preference";
import { fetchConfig, fetchHealth, type HarnessHealth } from "@/lib/api";
import {
  EMPTY_CATALOG,
  fetchModels,
  type ModelCatalog,
} from "@/lib/models";
import type { HarnessConfig } from "@/lib/types";

/**
 * The configuration surfaces that previously had nowhere to live: the harness
 * line squeezed into the sidebar footer, the mock state hidden inside a badge
 * tooltip, and the database health `/healthz` has always reported but nothing
 * rendered.
 *
 * Read-only apart from Appearance, and by design rather than omission.
 * `backend/app/core/config.py` is pydantic-settings over `backend/.env` with no
 * write path, Python's CORS allows only GET and POST, and there is no identity
 * anywhere in the app — so the only thing this page could persist is a browser
 * preference. That is exactly what the Appearance tab holds.
 *
 * This component is the shell: it owns the fetch and the tab choice, and each
 * tab below it is presentational. The fetch stays here rather than moving into
 * the tabs because Radix unmounts the inactive panels, so a per-tab fetch would
 * refire on every switch.
 */

const SETTINGS_TABS = ["general", "models", "appearance", "advanced"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

const TAB_META: { value: SettingsTab; label: string; icon: typeof Boxes }[] = [
  { value: "general", label: "General", icon: SlidersHorizontal },
  { value: "models", label: "Models", icon: Boxes },
  { value: "appearance", label: "Appearance", icon: Palette },
  { value: "advanced", label: "Advanced", icon: FlaskConical },
];

export default function SettingsBrowser() {
  const [config, setConfig] = useState<HarnessConfig | null>(null);
  const [health, setHealth] = useState<HarnessHealth | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY_CATALOG);
  const [settled, setSettled] = useState(false);

  // Which tab reopens on a return visit. Same shape as credentials_scope: the
  // choice is worth remembering and worth nothing if it fails to persist.
  const [tab, setTab] = useStoredPreference<SettingsTab>(
    "settings_tab",
    "general",
    SETTINGS_TABS,
  );

  // Browser-side for the same reason HarnessStatus is: API_BASE points at the
  // harness as the browser sees it, and a server fetch would block the page
  // render on Python being up. All three helpers resolve rather than throw.
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchConfig(controller.signal),
      fetchHealth(controller.signal),
      fetchModels(controller.signal),
    ])
      .then(([nextConfig, nextHealth, nextCatalog]) => {
        setConfig(nextConfig);
        setHealth(nextHealth);
        setCatalog(nextCatalog);
      })
      .finally(() => setSettled(true));
    return () => controller.abort();
  }, []);

  return (
    <Tabs value={tab} onValueChange={(next) => setTab(next as SettingsTab)}>
      <TabsList variant="line">
        {TAB_META.map((meta) => (
          <TabsTrigger key={meta.value} value={meta.value}>
            <meta.icon />
            {meta.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="general" className="pt-6">
        <GeneralTab config={config} health={health} settled={settled} />
      </TabsContent>
      <TabsContent value="models" className="pt-6">
        <ModelsTab catalog={catalog} config={config} settled={settled} />
      </TabsContent>
      <TabsContent value="appearance" className="pt-6">
        <AppearanceTab />
      </TabsContent>
      <TabsContent value="advanced" className="pt-6">
        <AdvancedTab config={config} />
      </TabsContent>
    </Tabs>
  );
}
