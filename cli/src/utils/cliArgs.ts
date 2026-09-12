import { basename } from 'node:path';

function resolveRawArgv(): string[] {
    const bunArgv = globalThis.Bun?.argv;
    if (Array.isArray(bunArgv) && bunArgv.length > 0) {
        return bunArgv;
    }
    return process.argv;
}

function isEntrypointPath(value: string, bunMain: string): boolean {
    if (!value) {
        return false;
    }
    if (bunMain) {
        return value === bunMain;
    }
    return /\.(c|m)?(ts|js)$/.test(value);
}

function hasRuntimeWrapper(preArgs: string[], execPath: string, execBase: string, bunMain: string): boolean {
    if (preArgs.length === 0) {
        return false;
    }
    if (preArgs[0] === 'bun') {
        return true;
    }
    if (preArgs.length < 2) {
        return false;
    }
    if (preArgs[0] !== execPath && preArgs[0] !== execBase) {
        return false;
    }
    return isEntrypointPath(preArgs[1], bunMain);
}

/** Drop bun/exec/entrypoint prefix so we can see if a HAPI command already follows. */
function stripRuntimePrefix(
    args: string[],
    execPath: string,
    execBase: string,
    bunMain: string
): string[] {
    if (args.length === 0) {
        return [];
    }

    let startIndex = 0;
    const nextValue = args[1] || '';
    if (args[0] === 'bun' && (
        nextValue === execPath || nextValue === execBase || isEntrypointPath(nextValue, bunMain)
    )) {
        startIndex += 1;
    }
    if (args[startIndex] === execPath || args[startIndex] === execBase) {
        startIndex += 1;
    }
    // Consume at most one entrypoint. Later filenames, even *.ts / *.js, are
    // user arguments, not additional runtime wrappers.
    if ((startIndex > 0 || (bunMain && args[0] === bunMain))
        && isEntrypointPath(args[startIndex] || '', bunMain)) {
        startIndex += 1;
    }

    // Only a separator immediately after the runtime/entrypoint is a wrapper
    // separator. A later `--` belongs to the selected command and its arguments.
    if (startIndex > 0 && args[startIndex] === '--') {
        startIndex += 1;
    }
    return args.slice(startIndex);
}

export function normalizeCliArgs(rawArgv: string[]): string[] {
    if (!Array.isArray(rawArgv) || rawArgv.length === 0) {
        return [];
    }

    const execPath = process.execPath;
    const execBase = basename(execPath);
    const bunMain = globalThis.Bun?.main ?? '';
    const dashIndex = rawArgv.indexOf('--');
    let argv = rawArgv.slice();
    if (dashIndex >= 0) {
        const preArgs = rawArgv.slice(0, dashIndex);
        const postArgs = rawArgv.slice(dashIndex + 1);
        const normalizedPre = stripRuntimePrefix(preArgs, execPath, execBase, bunMain);
        // Only `job run … -- <cmd>` needs the child separator preserved.
        // `hapi -- auth login` / `hapi codex -- --model o3` must keep stripping.
        const keepSeparator = normalizedPre[0] === 'job' && normalizedPre[1] === 'run';
        if (
            hasRuntimeWrapper(preArgs, execPath, execBase, bunMain)
            && normalizedPre.length === 0
        ) {
            // `bun src/index.ts -- auth login` → only postArgs (runtime handoff).
            argv = postArgs;
        } else {
            argv = keepSeparator
                ? [...preArgs, '--', ...postArgs]
                : [...preArgs, ...postArgs];
        }
    }

    return stripRuntimePrefix(argv, execPath, execBase, bunMain);
}

export function getCliArgs(): string[] {
    return normalizeCliArgs(resolveRawArgv());
}
