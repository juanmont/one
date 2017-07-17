"use strict";
const vscode_1 = require("vscode");
const child_process_1 = require("child_process");
const fs = require("fs");
const path = require("path");
let fileUrl = require("file-url");
function activate(context) {
    let provider = new RstDocumentContentProvider(context);
    let registration = vscode_1.workspace.registerTextDocumentContentProvider("restructuredtext", provider);
    let d1 = vscode_1.commands.registerCommand("restructuredtext.showPreview", showPreview);
    let d2 = vscode_1.commands.registerCommand("restructuredtext.showPreviewToSide", uri => showPreview(uri, true));
    let d3 = vscode_1.commands.registerCommand("restructuredtext.showSource", showSource);
    context.subscriptions.push(d1, d2, d3, registration);
    vscode_1.workspace.onDidSaveTextDocument(document => {
        if (isRstFile(document)) {
            const uri = getRstUri(document.uri);
            provider.update(uri);
        }
    });
    let updateOnTextChanged = RstDocumentContentProvider.loadSetting("updateOnTextChanged", "true");
    if (updateOnTextChanged === 'true') {
        vscode_1.workspace.onDidChangeTextDocument(event => {
            if (isRstFile(event.document)) {
                const uri = getRstUri(event.document.uri);
                provider.update(uri);
            }
        });
    }
    vscode_1.workspace.onDidChangeConfiguration(() => {
        vscode_1.workspace.textDocuments.forEach(document => {
            if (document.uri.scheme === 'restructuredtext') {
                // update all generated md documents
                provider.update(document.uri);
            }
        });
    });
}
exports.activate = activate;
function isRstFile(document) {
    return document.languageId === 'restructuredtext'
        && document.uri.scheme !== 'restructuredtext'; // prevent processing of own documents
}
function getRstUri(uri) {
    return uri.with({ scheme: 'restructuredtext', path: uri.path + '.rendered', query: uri.toString() });
}
function showPreview(uri, sideBySide = false) {
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
            return vscode_1.commands.executeCommand('restructuredtext.showSource');
        }
        // nothing found that could be shown or toggled
        return;
    }
    let thenable = vscode_1.commands.executeCommand('vscode.previewHtml', getRstUri(resource), getViewColumn(sideBySide), `Preview '${path.basename(resource.fsPath)}'`);
    return thenable;
}
function getViewColumn(sideBySide) {
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
function showSource(mdUri) {
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
// this method is called when your extension is deactivated
function deactivate() {
}
exports.deactivate = deactivate;
class RstDocumentContentProvider {
    constructor(context) {
        this._onDidChange = new vscode_1.EventEmitter();
        this._context = context;
        this._waiting = false;
        this._channel = vscode_1.window.createOutputChannel("reStructuredText");
        context.subscriptions.push(this._channel);
    }
    provideTextDocumentContent(uri) {
        let root = vscode_1.workspace.rootPath;
        this._input = RstDocumentContentProvider.loadSetting("confPath", root);
        this._output = RstDocumentContentProvider.loadSetting("builtDocumentationPath", path.join(root, "_build", "html"));
        let quotedOutput = "\"" + this._output + "\"";
        var python = RstDocumentContentProvider.loadSetting("pythonPath", null, "python");
        var build;
        if (python == null) {
            build = RstDocumentContentProvider.loadSetting('sphinxBuildPath', null);
        }
        else {
            build = python + " -msphinx";
        }
        if (build == null) {
            build = "sphinx-build";
        }
        this._options = { cwd: this._input };
        this._cmd = [
            build,
            "-b html",
            ".",
            quotedOutput
        ].join(" ");
        return this.preview(uri);
    }
    get onDidChange() {
        return this._onDidChange.event;
    }
    update(uri) {
        if (!this._waiting) {
            this._waiting = true;
            setTimeout(() => {
                this._waiting = false;
                this._onDidChange.fire(uri);
            }, 300);
        }
    }
    errorSnippet(error) {
        return `
                <body>
                    ${error}
                </body>`;
    }
    fixLinks(document, documentPath) {
        return document.replace(new RegExp("((?:src|href)=[\'\"])(.*?)([\'\"])", "gmi"), (subString, p1, p2, p3) => {
            return [
                p1,
                fileUrl(path.join(path.dirname(documentPath), p2)),
                p3
            ].join("");
        });
    }
    static loadSetting(configSection, defaultValue, header = "restructuredtext", expand = true) {
        var result = vscode_1.workspace.getConfiguration(header).get(configSection, defaultValue);
        if (expand && result != null) {
            return RstDocumentContentProvider.expandMacro(result);
        }
        return result;
    }
    static expandMacro(input) {
        let root = vscode_1.workspace.rootPath;
        return input.replace("${workspaceRoot}", root);
    }
    relativeDocumentationPath(whole) {
        return whole.substring(this._input.length);
    }
    preview(uri) {
        // Calculate full path to built html file.
        let whole = uri.fsPath;
        if (whole.endsWith(".rendered"))
            whole = whole.substring(0, whole.lastIndexOf("."));
        let ext = whole.lastIndexOf(".");
        whole = whole.substring(0, ext) + ".html";
        let finalName = path.join(this._output, this.relativeDocumentationPath(whole));
        this._channel.appendLine("Source file: " + uri.fsPath);
        this._channel.appendLine("Compiler: " + this._cmd);
        this._channel.appendLine("HTML file: " + finalName);
        // Display file.
        return new Promise((resolve, reject) => {
            child_process_1.exec(this._cmd, this._options, (error, stdout, stderr) => {
                if (error) {
                    let errorMessage = [
                        error.name,
                        error.message,
                        error.stack,
                        "",
                        stderr.toString()
                    ].join("\n");
                    console.error(errorMessage);
                    this._channel.appendLine("Error: " + errorMessage);
                    reject(errorMessage);
                    return;
                }
                if (process.platform === "win32" && stderr) {
                    let errorMessage = stderr.toString();
                    if (errorMessage.indexOf("Exception occurred:") > -1) {
                        console.error(errorMessage);
                        this._channel.appendLine("Error: " + errorMessage);
                        reject(errorMessage);
                        return;
                    }
                }
                fs.stat(finalName, (error, stat) => {
                    if (error !== null) {
                        let errorMessage = [
                            error.name,
                            error.message,
                            error.stack
                        ].join("\n");
                        console.error(errorMessage);
                        this._channel.appendLine("Error: " + errorMessage);
                        reject(errorMessage);
                        return;
                    }
                    fs.readFile(finalName, "utf8", (err, data) => {
                        if (err === null) {
                            let fixed = this.fixLinks(data, finalName);
                            resolve(fixed);
                        }
                        else {
                            let errorMessage = [
                                err.name,
                                err.message,
                                err.stack
                            ].join("\n");
                            console.error(errorMessage);
                            this._channel.appendLine("Error: " + errorMessage);
                            reject(errorMessage);
                        }
                    });
                });
            });
        });
    }
}
//# sourceMappingURL=extension.js.map