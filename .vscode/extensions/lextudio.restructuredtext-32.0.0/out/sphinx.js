'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const cp = require("child_process");
const events_1 = require("events");
const iconv = require("iconv-lite");
const util_1 = require("./util");
function exec(child, options = {}) {
    return __awaiter(this, void 0, void 0, function* () {
        const disposables = [];
        const once = (ee, name, fn) => {
            ee.once(name, fn);
            disposables.push(util_1.toDisposable(() => ee.removeListener(name, fn)));
        };
        const on = (ee, name, fn) => {
            ee.on(name, fn);
            disposables.push(util_1.toDisposable(() => ee.removeListener(name, fn)));
        };
        let encoding = options.encoding || 'utf8';
        encoding = iconv.encodingExists(encoding) ? encoding : 'utf8';
        const [exitCode, stdout, stderr] = yield Promise.all([
            new Promise((c, e) => {
                once(child, 'error', e);
                once(child, 'exit', c);
            }),
            new Promise(c => {
                const buffers = [];
                on(child.stdout, 'data', b => buffers.push(b));
                once(child.stdout, 'close', () => c(iconv.decode(Buffer.concat(buffers), encoding)));
            }),
            new Promise(c => {
                const buffers = [];
                on(child.stderr, 'data', b => buffers.push(b));
                once(child.stderr, 'close', () => c(Buffer.concat(buffers).toString('utf8')));
            })
        ]);
        util_1.dispose(disposables);
        return { exitCode, stdout, stderr };
    });
}
class SphinxError {
    constructor(data) {
        if (data.error) {
            this.error = data.error;
            this.message = data.error.message;
        }
        else {
            this.error = void 0;
        }
        this.message = this.message || data.message || 'Git error';
        this.stdout = data.stdout;
        this.stderr = data.stderr;
        this.exitCode = data.exitCode;
        this.sphinxErrorCode = data.sphinxErrorCode;
        this.sphinxCommand = data.sphinxCommand;
    }
    toString() {
        let result = this.message + ' ' + JSON.stringify({
            exitCode: this.exitCode,
            gitErrorCode: this.sphinxErrorCode,
            gitCommand: this.sphinxCommand,
            stdout: this.stdout,
            stderr: this.stderr
        }, [], 2);
        if (this.error) {
            result += this.error.stack;
        }
        return result;
    }
}
exports.SphinxError = SphinxError;
exports.SphinxErrorCodes = {
    BadConfigFile: 'BadConfigFile',
    AuthenticationFailed: 'AuthenticationFailed',
    NoUserNameConfigured: 'NoUserNameConfigured',
    NoUserEmailConfigured: 'NoUserEmailConfigured',
    NoRemoteRepositorySpecified: 'NoRemoteRepositorySpecified',
    NotAGitRepository: 'NotAGitRepository',
    NotAtRepositoryRoot: 'NotAtRepositoryRoot',
    Conflict: 'Conflict',
    UnmergedChanges: 'UnmergedChanges',
    PushRejected: 'PushRejected',
    RemoteConnectionError: 'RemoteConnectionError',
    DirtyWorkTree: 'DirtyWorkTree',
    CantOpenResource: 'CantOpenResource',
    GitNotFound: 'GitNotFound',
    CantCreatePipe: 'CantCreatePipe',
    CantAccessRemote: 'CantAccessRemote',
    RepositoryNotFound: 'RepositoryNotFound',
    RepositoryIsLocked: 'RepositoryIsLocked',
    BranchNotFullyMerged: 'BranchNotFullyMerged'
};
function getSphinxErrorCode(stderr) {
    if (/Another git process seems to be running in this repository|If no other git process is currently running/.test(stderr)) {
        return exports.SphinxErrorCodes.RepositoryIsLocked;
    }
    else if (/Authentication failed/.test(stderr)) {
        return exports.SphinxErrorCodes.AuthenticationFailed;
    }
    else if (/Not a git repository/.test(stderr)) {
        return exports.SphinxErrorCodes.NotAGitRepository;
    }
    else if (/bad config file/.test(stderr)) {
        return exports.SphinxErrorCodes.BadConfigFile;
    }
    else if (/cannot make pipe for command substitution|cannot create standard input pipe/.test(stderr)) {
        return exports.SphinxErrorCodes.CantCreatePipe;
    }
    else if (/Repository not found/.test(stderr)) {
        return exports.SphinxErrorCodes.RepositoryNotFound;
    }
    else if (/unable to access/.test(stderr)) {
        return exports.SphinxErrorCodes.CantAccessRemote;
    }
    else if (/branch '.+' is not fully merged/.test(stderr)) {
        return exports.SphinxErrorCodes.BranchNotFullyMerged;
    }
    return void 0;
}
class Sphinx {
    constructor(options) {
        this._onOutput = new events_1.EventEmitter();
        this.sphinxPath = options.sphinxPath;
        this.version = options.version;
        this.env = options.env || {};
    }
    get onOutput() { return this._onOutput; }
    preview(command, args) {
        return __awaiter(this, void 0, void 0, function* () {
            this.sphinxPath = command;
            yield this.exec("", args);
            return;
        });
    }
    exec(cwd, args, options = {}) {
        return __awaiter(this, void 0, void 0, function* () {
            options = util_1.assign({ cwd }, options || {});
            return yield this._exec(args, options);
        });
    }
    _exec(args, options = {}) {
        return __awaiter(this, void 0, void 0, function* () {
            const child = this.spawn(args, options);
            if (options.input) {
                child.stdin.end(options.input, 'utf8');
            }
            const result = yield exec(child, options);
            if (options.log !== false && result.stderr.length > 0) {
                this.log(`${result.stderr}\n`);
            }
            if (result.exitCode) {
                return Promise.reject(new SphinxError({
                    message: 'Failed to execute sphinx',
                    stdout: result.stdout,
                    stderr: result.stderr,
                    exitCode: result.exitCode,
                    sphinxErrorCode: getSphinxErrorCode(result.stderr),
                    sphinxCommand: args[0]
                }));
            }
            return result;
        });
    }
    spawn(args, options = {}) {
        if (!this.sphinxPath) {
            throw new Error('sphinx could not be found in the system.');
        }
        if (!options) {
            options = {};
        }
        if (!options.stdio && !options.input) {
            options.stdio = ['ignore', null, null]; // Unless provided, ignore stdin and leave default streams for stdout and stderr
        }
        options.env = util_1.assign({}, process.env, this.env, options.env || {}, {
            VSCODE_GIT_COMMAND: args[0],
            LC_ALL: 'en_US.UTF-8',
            LANG: 'en_US.UTF-8'
        });
        if (options.log !== false) {
            this.log(`sphinx ${args.join(' ')}\n`);
        }
        return cp.spawn(this.sphinxPath, args, options);
    }
    log(output) {
        this._onOutput.emit('log', output);
    }
}
exports.Sphinx = Sphinx;
//# sourceMappingURL=sphinx.js.map