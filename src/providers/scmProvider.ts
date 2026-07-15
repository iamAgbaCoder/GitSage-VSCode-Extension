/**
 * GitSage AI — SCM Provider
 *
 * Registers the "Generate with GitSage AI" action in the Source Control
 * title bar (scm/title menu). This is registered as a command in package.json
 * and simply delegates to the commit command.
 */

import * as vscode from "vscode";

export function registerScmCommand(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand("gitsage.scmGenerate", async () => {
    const scmIntegration = vscode.workspace
      .getConfiguration("gitsage")
      .get<boolean>("scmIntegration", true);

    if (!scmIntegration) {
      vscode.window.showInformationMessage(
        "GitSage: SCM integration is disabled. Enable it in Settings > GitSage."
      );
      return;
    }

    // Open the panel first for visual feedback, then run the commit flow
    await vscode.commands.executeCommand("gitsage.showPanel");
    await vscode.commands.executeCommand("gitsage.commit");
  });

  context.subscriptions.push(cmd);
}
