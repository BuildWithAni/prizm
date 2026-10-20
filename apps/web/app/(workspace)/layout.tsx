import { CreditsProvider } from "../../components/workspace/CreditsProvider";
import { WorkspaceProvider } from "../../components/workspace/WorkspaceProvider";

/**
 * Route group for the workspace pages (editor + visualizer).
 *
 * Both pages render inside one WorkspaceProvider, so the code, language and
 * recorded trace survive navigating between writing code and watching it run.
 * Credits wrap the workspace: both pages gate visualization on the allowance.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <CreditsProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </CreditsProvider>
  );
}
