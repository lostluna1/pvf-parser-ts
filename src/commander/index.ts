import * as vscode from 'vscode';
import { Deps } from './types';
import { registerSetNpkRoot } from './setNpkRoot';
import { registerOpenNpk } from './openNpk';
import { registerPreviewAni } from './previewAni';
import { registerAniEditor } from './aniEditor';
import { registerPvfFileOps } from './pvfFileOps';
import { registerOpeners } from './openers';

export function registerAllCommands(context: vscode.ExtensionContext, deps: Deps) {
  registerSetNpkRoot(context, deps);
  registerPreviewAni(context, deps);
  registerAniEditor(context, deps);
  registerOpenNpk(context, deps);
  registerPvfFileOps(context, deps);
  registerOpeners(context, deps);
}
