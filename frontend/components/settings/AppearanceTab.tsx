"use client";

import { Laptop, Moon, RotateCcw, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import SectionHeader from "@/components/registry/SectionHeader";
import { Panel, Row } from "@/components/settings/SettingsPanel";
import ViewSwitch, {
  VIEW_MODES,
  type ViewMode,
} from "@/components/registry/ViewSwitch";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  clearStoredPreferences,
  useStoredPreference,
} from "@/hooks/use-stored-preference";
import { NAV_GROUPS } from "@/lib/nav";

/**
 * The only tab that writes anything.
 *
 * All of it is per-browser, and that is not a shortcut: there is no user table
 * and no identity anywhere in the app, so there is nowhere else for a
 * preference to live. Everything here goes through next-themes or the
 * `harness_pref:` localStorage namespace, neither of which touches the harness.
 */
export default function AppearanceTab() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Theme"
          hint="Stored by next-themes in this browser. System follows the OS preference live, and this is the only way back to it — the header toggle just flips light and dark."
        />
        <Panel>
          <ThemePicker />
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Layout"
          hint="Applies to pages that have not been given their own view yet; switching the view on a page still overrides this for that page."
        />
        <Panel>
          <DefaultViewRow />
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Sidebar groups"
          hint="Which rail sections start expanded. The rail updates as you toggle — these are the same preferences it reads."
        />
        <Panel>
          {NAV_GROUPS.map((group) => (
            <NavGroupRow key={group.id} id={group.id} label={group.label} defaultOpen={group.defaultOpen} />
          ))}
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Reset"
          hint="Clears the harness_pref: keys only. Theme belongs to next-themes and is left alone."
        />
        <Panel>
          <ResetRow />
        </Panel>
      </section>
    </div>
  );
}

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
] as const;

const noopSubscribe = () => () => {};

/**
 * False through the server render and hydration, true after — the same
 * useSyncExternalStore shape as lib/session.ts, for the same reason. Setting a
 * flag from an effect would say the same thing but is what
 * react-hooks/set-state-in-effect exists to reject.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Unlike the header toggle, this has to show which option is *selected*, and
 * the server cannot know that — hence the hydration gate, which keeps the
 * first paint identical on both sides. ThemeToggle sidesteps the whole problem
 * by deciding its icon in CSS off the `.dark` class.
 */
function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  return (
    <div className="flex flex-wrap gap-2 p-4">
      {THEMES.map((option) => (
        <Button
          key={option.value}
          variant={hydrated && theme === option.value ? "default" : "outline"}
          size="sm"
          onClick={() => setTheme(option.value)}
        >
          <option.icon />
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function DefaultViewRow() {
  const [view, setView] = useStoredPreference<ViewMode>(
    "default_view",
    "grid",
    VIEW_MODES,
  );

  return (
    <Row
      label="Default view"
      hint="Grid or list, for card pages opened for the first time."
      value={<ViewSwitch value={view} onChange={setView} />}
    />
  );
}

const OPEN_STATES = ["open", "closed"] as const;

/**
 * One component per group rather than a hook called inside a map: NAV_GROUPS is
 * a module constant so the length never changes, but rules-of-hooks is not
 * something to be clever about.
 */
function NavGroupRow({
  id,
  label,
  defaultOpen,
}: {
  id: string;
  label: string;
  defaultOpen: boolean;
}) {
  const [state, setState] = useStoredPreference<(typeof OPEN_STATES)[number]>(
    `nav_group_${id}`,
    defaultOpen ? "open" : "closed",
    OPEN_STATES,
  );

  return (
    <Row
      label={label}
      value={
        <Switch
          checked={state === "open"}
          onCheckedChange={(next) => setState(next ? "open" : "closed")}
          aria-label={`${label} group expanded`}
        />
      }
    />
  );
}

function ResetRow() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      <p className="min-w-40 max-w-md text-sm text-muted-foreground">
        Forget the view, sidebar and tab choices this browser has stored. Nothing
        on the harness changes, and no content is deleted.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="ml-auto"
        onClick={clearStoredPreferences}
      >
        <RotateCcw />
        Reset stored preferences
      </Button>
    </div>
  );
}
