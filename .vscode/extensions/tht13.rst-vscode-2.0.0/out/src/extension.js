"use strict";
const vscode_1 = require("vscode");
const uuid = require("node-uuid");
const document_1 = require("./document");
let viewManager;
function activate(context) {
    viewManager = new ViewManager();
    context.subscriptions.push(vscode_1.commands.registerCommand("rst.previewToSide", uri => viewManager.preview(uri, true)), vscode_1.commands.registerCommand("rst.preview", () => viewManager.preview()), vscode_1.commands.registerCommand("rst.source", () => viewManager.source()));
}
exports.activate = activate;
function deactivate() {
    viewManager.dispose();
}
exports.deactivate = deactivate;
class ViewManager {
    constructor() {
        this.idMap = new IDMap();
        this.fileMap = new Map();
    }
    sendRSTCommand(displayColumn, doc, toggle = false) {
        let id;
        let rstDoc;
        if (!this.idMap.hasUri(doc.uri)) {
            rstDoc = new document_1.RSTDocumentView(doc);
            id = this.idMap.add(doc.uri, rstDoc.uri);
            this.fileMap.set(id, rstDoc);
        }
        else {
            id = this.idMap.getByUri(doc.uri);
            rstDoc = this.fileMap.get(id);
        }
        rstDoc.execute(displayColumn);
    }
    getViewColumn(sideBySide) {
        const active = vscode_1.window.activeTextEditor;
        if (!active) {
            return vscode_1.ViewColumn.One;
        }
        if (!sideBySide) {
            return active.viewColumn;
        }
        switch (active.viewColumn) {
            case vscode_1.ViewColumn.One:
                return vscode_1.ViewColumn.Two;
            case vscode_1.ViewColumn.Two:
                return vscode_1.ViewColumn.Three;
        }
        return active.viewColumn;
    }
    source(mdUri) {
        if (!mdUri) {
            return vscode_1.commands.executeCommand('workbench.action.navigateBack');
        }
        const docUri = vscode_1.Uri.parse(mdUri.query);
        for (let editor of vscode_1.window.visibleTextEditors) {
            if (editor.document.uri.toString() === docUri.toString()) {
                return vscode_1.window.showTextDocument(editor.document, editor.viewColumn);
            }
        }
        return vscode_1.workspace.openTextDocument(docUri).then(doc => {
            return vscode_1.window.showTextDocument(doc);
        });
    }
    preview(uri, sideBySide = false) {
        let resource = uri;
        if (!(resource instanceof vscode_1.Uri)) {
            if (vscode_1.window.activeTextEditor) {
                // we are relaxed and don't check for markdown files
                resource = vscode_1.window.activeTextEditor.document.uri;
            }
        }
        if (!(resource instanceof vscode_1.Uri)) {
            if (!vscode_1.window.activeTextEditor) {
                // this is most likely toggling the preview
                return vscode_1.commands.executeCommand('rst.source');
            }
            // nothing found that could be shown or toggled
            return;
        }
        // activeTextEditor does not exist when triggering on a rst preview
        this.sendRSTCommand(this.getViewColumn(sideBySide), vscode_1.window.activeTextEditor.document);
    }
    dispose() {
        let values = this.fileMap.values();
        let value = values.next();
        while (!value.done) {
            value.value.dispose();
            value = values.next();
        }
    }
}
class IDMap {
    constructor() {
        this.map = new Map();
    }
    getByUri(uri) {
        let keys = this.map.keys();
        let key = keys.next();
        while (!key.done) {
            if (key.value.indexOf(uri) > -1) {
                return this.map.get(key.value);
            }
            key = keys.next();
        }
        return null;
    }
    hasUri(uri) {
        return this.getByUri(uri) !== null;
    }
    add(uri1, uri2) {
        let id = uuid.v4();
        this.map.set([uri1, uri2], id);
        return id;
    }
}
//# sourceMappingURL=extension.js.map