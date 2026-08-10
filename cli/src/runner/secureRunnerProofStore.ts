import { execFileSync } from 'node:child_process'
import { logger } from '@/ui/logger'

/**
 * OS-backed recovery for memory-only runnerProof across ordinary restarts
 * (#1473 Major). Prefer this over minting a fresh proof that rotates machineId
 * and strands sessions. Same-UID can still read OS keyrings; the goal is to
 * avoid silent identity rotation, not defeat same-UID ptrace.
 */

const SERVICE = 'hapi.runnerProof'

export async function loadSecureRunnerProof(machineId: string): Promise<string | undefined> {
    const id = machineId.trim()
    if (!id) {
        return undefined
    }
    try {
        if (process.platform === 'linux') {
            return loadLinuxKeyctl(id)
        }
        if (process.platform === 'darwin') {
            return loadDarwinKeychain(id)
        }
        if (process.platform === 'win32') {
            return loadWindowsCredential(id)
        }
    } catch (error) {
        logger.debug('[runner-proof-store] load failed', error)
    }
    return undefined
}

export async function saveSecureRunnerProof(machineId: string, proof: string): Promise<void> {
    const id = machineId.trim()
    const value = proof.trim()
    if (!id || !value) {
        return
    }
    try {
        if (process.platform === 'linux') {
            saveLinuxKeyctl(id, value)
            return
        }
        if (process.platform === 'darwin') {
            saveDarwinKeychain(id, value)
            return
        }
        if (process.platform === 'win32') {
            saveWindowsCredential(id, value)
        }
    } catch (error) {
        logger.debug('[runner-proof-store] save failed', error)
    }
}

export async function clearSecureRunnerProof(machineId: string): Promise<void> {
    const id = machineId.trim()
    if (!id) {
        return
    }
    try {
        if (process.platform === 'linux') {
            clearLinuxKeyctl(id)
            return
        }
        if (process.platform === 'darwin') {
            clearDarwinKeychain(id)
            return
        }
        if (process.platform === 'win32') {
            clearWindowsCredential(id)
        }
    } catch (error) {
        logger.debug('[runner-proof-store] clear failed', error)
    }
}

function loadLinuxKeyctl(machineId: string): string | undefined {
    const keyId = execFileSync(
        'keyctl',
        ['search', '@u', 'user', `${SERVICE}.${machineId}`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
    if (!/^\d+$/.test(keyId)) {
        return undefined
    }
    const proof = execFileSync('keyctl', ['pipe', keyId], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return proof || undefined
}

function saveLinuxKeyctl(machineId: string, proof: string): void {
    clearLinuxKeyctl(machineId)
    execFileSync('keyctl', ['padd', 'user', `${SERVICE}.${machineId}`, '@u'], {
        input: proof,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
    })
}

function clearLinuxKeyctl(machineId: string): void {
    try {
        const keyId = execFileSync(
            'keyctl',
            ['search', '@u', 'user', `${SERVICE}.${machineId}`],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        ).trim()
        if (/^\d+$/.test(keyId)) {
            execFileSync('keyctl', ['unlink', keyId, '@u'], {
                stdio: ['ignore', 'ignore', 'ignore'],
            })
        }
    } catch {
        // absent
    }
}

function loadDarwinKeychain(machineId: string): string | undefined {
    const proof = execFileSync(
        'security',
        ['find-generic-password', '-a', machineId, '-s', SERVICE, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
    return proof || undefined
}

function saveDarwinKeychain(machineId: string, proof: string): void {
    execFileSync(
        'security',
        ['add-generic-password', '-a', machineId, '-s', SERVICE, '-w', proof, '-U'],
        { stdio: ['ignore', 'ignore', 'ignore'] }
    )
}

function clearDarwinKeychain(machineId: string): void {
    try {
        execFileSync(
            'security',
            ['delete-generic-password', '-a', machineId, '-s', SERVICE],
            { stdio: ['ignore', 'ignore', 'ignore'] }
        )
    } catch {
        // absent
    }
}

function loadWindowsCredential(machineId: string): string | undefined {
    // PowerShell CredMan target: LegacyGeneric:target=hapi.runnerProof/<id>
    const script = [
        '$ErrorActionPreference = "Stop"',
        `Add-Type -TypeDefinition @"`,
        'using System;',
        'using System.Runtime.InteropServices;',
        'using System.Text;',
        'public class HapiCredRead {',
        '  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]',
        '  public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName;',
        '    public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;',
        '    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;',
        '    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }',
        '  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]',
        '  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);',
        '  [DllImport("advapi32.dll", SetLastError=true)] public static extern void CredFree(IntPtr buffer);',
        '  public static string Read(string target) {',
        '    IntPtr ptr; if (!CredRead(target, 1, 0, out ptr)) return null;',
        '    try { var c = Marshal.PtrToStructure<CREDENTIAL>(ptr);',
        '      if (c.CredentialBlob == IntPtr.Zero || c.CredentialBlobSize == 0) return null;',
        '      return Marshal.PtrToStringUni(c.CredentialBlob, (int)c.CredentialBlobSize / 2);',
        '    } finally { CredFree(ptr); } }',
        '}',
        '"@',
        `$r = [HapiCredRead]::Read("${SERVICE}/${machineId}")`,
        'if ($r) { Write-Output $r }',
    ].join('; ')
    const proof = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return proof || undefined
}

function saveWindowsCredential(machineId: string, proof: string): void {
    const script = [
        '$ErrorActionPreference = "Stop"',
        `Add-Type -TypeDefinition @"`,
        'using System;',
        'using System.Runtime.InteropServices;',
        'public class HapiCredWrite {',
        '  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]',
        '  public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName;',
        '    public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;',
        '    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;',
        '    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }',
        '  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]',
        '  public static extern bool CredWrite(ref CREDENTIAL userCredential, uint flags);',
        '  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]',
        '  public static extern bool CredDelete(string target, uint type, uint flags);',
        '  public static void Write(string target, string secret) {',
        '    CredDelete(target, 1, 0);',
        '    var bytes = System.Text.Encoding.Unicode.GetBytes(secret);',
        '    var handle = Marshal.AllocHGlobal(bytes.Length);',
        '    try { Marshal.Copy(bytes, 0, handle, bytes.Length);',
        '      var c = new CREDENTIAL { Type = 1, Persist = 2, TargetName = target, UserName = "hapi",',
        '        CredentialBlobSize = (uint)bytes.Length, CredentialBlob = handle };',
        '      if (!CredWrite(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());',
        '    } finally { Marshal.FreeHGlobal(handle); } }',
        '}',
        '"@',
        `[HapiCredWrite]::Write("${SERVICE}/${machineId}", @'`,
        proof,
        `'@)`,
    ].join('\n')
    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
        stdio: ['ignore', 'ignore', 'ignore'],
    })
}

function clearWindowsCredential(machineId: string): void {
    try {
        execFileSync(
            'powershell.exe',
            [
                '-NoProfile',
                '-Command',
                `[void][System.Reflection.Assembly]::LoadWithPartialName('System'); `
                + `Add-Type -Namespace Hapi -Name Cred -MemberDefinition '[DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool CredDelete(string t,uint ty,uint f);'; `
                + `[Hapi.Cred]::CredDelete('${SERVICE}/${machineId}',1,0)`,
            ],
            { stdio: ['ignore', 'ignore', 'ignore'] }
        )
    } catch {
        // absent
    }
}
