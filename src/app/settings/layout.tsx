import { SettingsShell } from "@/components/settings/SettingsShell";

// Every /settings/* route (recurring bills included) renders inside the two-pane shell, so the
// section nav stays put while the right side changes. The sub-routes stay real pages: deep
// links, back links and server-action revalidatePath calls all keep working.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
