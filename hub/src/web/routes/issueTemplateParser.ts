import { parse as parseYaml } from 'yaml'
import type { IssueFormCheckboxOption, IssueFormField, IssueTemplate } from '@hapi/protocol'

const SUPPORTED_FIELD_TYPES = new Set(['markdown', 'input', 'textarea', 'dropdown', 'checkboxes'])

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/**
 * Parses one `.github/ISSUE_TEMPLATE/*.yml` issue form into a normalized
 * `IssueTemplate`, or an `unsupported` marker when the form uses a
 * body-element `type` outside `markdown`/`input`/`textarea`/`dropdown`/
 * `checkboxes` (operator decision, hapi#238: the whole template is excluded
 * rather than rendered with that one field silently dropped — "partial
 * support that fails loudly beats full support that silently drops a
 * field").
 */
export function parseIssueFormYaml(id: string, raw: string): IssueTemplate {
    let doc: unknown
    try {
        doc = parseYaml(raw)
    } catch {
        return { id, name: id, kind: 'unsupported', reason: 'Could not parse this template\'s YAML' }
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        return { id, name: id, kind: 'unsupported', reason: 'Template is not a valid issue form' }
    }
    const obj = doc as Record<string, unknown>
    const name = asString(obj.name) ?? id
    const bodyRaw = obj.body
    if (!Array.isArray(bodyRaw) || bodyRaw.length === 0) {
        return { id, name, kind: 'unsupported', reason: 'Template has no body elements' }
    }

    const fields: IssueFormField[] = []
    for (const element of bodyRaw) {
        if (!element || typeof element !== 'object') {
            return { id, name, kind: 'unsupported', reason: 'Template body contains a malformed element' }
        }
        const elObj = element as Record<string, unknown>
        const type = elObj.type
        if (typeof type !== 'string' || !SUPPORTED_FIELD_TYPES.has(type)) {
            return {
                id,
                name,
                kind: 'unsupported',
                reason: `Uses a form feature not supported yet (${typeof type === 'string' ? `type: ${type}` : 'missing field type'})`
            }
        }

        const attrs = asRecord(elObj.attributes)

        if (type === 'markdown') {
            fields.push({ kind: 'markdown', value: asString(attrs.value) ?? '' })
            continue
        }

        const fieldId = asString(elObj.id)
        const label = asString(attrs.label)
        if (!fieldId || !label) {
            return { id, name, kind: 'unsupported', reason: `A "${type}" field is missing an id or label` }
        }
        const description = asString(attrs.description)
        const required = asRecord(elObj.validations).required === true

        if (type === 'input') {
            fields.push({
                kind: 'input',
                id: fieldId,
                label,
                description,
                placeholder: asString(attrs.placeholder),
                value: asString(attrs.value),
                required
            })
        } else if (type === 'textarea') {
            fields.push({
                kind: 'textarea',
                id: fieldId,
                label,
                description,
                placeholder: asString(attrs.placeholder),
                value: asString(attrs.value),
                render: asString(attrs.render),
                required
            })
        } else if (type === 'dropdown') {
            const options = asStringArray(attrs.options)
            if (options.length === 0) {
                return { id, name, kind: 'unsupported', reason: `Dropdown field "${label}" has no options` }
            }
            fields.push({
                kind: 'dropdown',
                id: fieldId,
                label,
                description,
                options,
                multiple: attrs.multiple === true,
                defaultIndex: typeof attrs.default === 'number' ? attrs.default : undefined,
                required
            })
        } else {
            const rawOptions = Array.isArray(attrs.options) ? attrs.options : []
            const options: IssueFormCheckboxOption[] = []
            for (const rawOption of rawOptions) {
                const optionLabel = asString(asRecord(rawOption).label)
                if (!optionLabel) {
                    return { id, name, kind: 'unsupported', reason: `Checkboxes field "${label}" has a malformed option` }
                }
                options.push({ label: optionLabel, required: asRecord(rawOption).required === true })
            }
            if (options.length === 0) {
                return { id, name, kind: 'unsupported', reason: `Checkboxes field "${label}" has no options` }
            }
            fields.push({ kind: 'checkboxes', id: fieldId, label, description, options })
        }
    }

    return {
        id,
        name,
        description: asString(obj.description),
        titlePrefix: asString(obj.title),
        // GitHub's issue-form schema allows labels/assignees as either a
        // YAML list or a comma-delimited string (review finding) — the same
        // asStringListField the legacy .md parser below already uses for
        // these two fields, not the stricter array-only asStringArray.
        labels: asStringListField(obj.labels),
        assignees: asStringListField(obj.assignees),
        kind: 'form',
        fields
    }
}

function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
    if (!match) {
        return { frontmatter: {}, body: raw.trim() }
    }
    try {
        const parsed = parseYaml(match[1] ?? '')
        return { frontmatter: asRecord(parsed), body: (match[2] ?? '').trim() }
    } catch {
        // Malformed frontmatter — treat the whole file as plain body, no metadata.
        return { frontmatter: {}, body: raw.trim() }
    }
}

/** YAML list or GitHub's comma-separated legacy frontmatter shorthand, both valid for `labels`/`assignees`. */
function asStringListField(value: unknown): string[] {
    if (typeof value === 'string') {
        return value.split(',').map(entry => entry.trim()).filter(Boolean)
    }
    return asStringArray(value)
}

/**
 * Parses a legacy `.github/ISSUE_TEMPLATE/*.md` template (YAML frontmatter +
 * free-text markdown body) — no structured fields, explicitly required
 * alongside `.yml` issue forms (operator decision, hapi#238: repositories
 * that haven't migrated to issue forms are a real case, not an edge case to
 * ignore).
 */
export function parseLegacyIssueTemplate(id: string, raw: string): IssueTemplate {
    const { frontmatter, body } = splitFrontmatter(raw)
    return {
        id,
        name: asString(frontmatter.name) ?? id,
        description: asString(frontmatter.about),
        titlePrefix: asString(frontmatter.title),
        labels: asStringListField(frontmatter.labels),
        assignees: asStringListField(frontmatter.assignees),
        kind: 'legacy',
        body
    }
}

/**
 * `.github/ISSUE_TEMPLATE/config.yml`'s `blank_issues_enabled` flag.
 * Defaults to allowed on any parse failure — a malformed config.yml should
 * never be the reason creation is blocked entirely.
 */
export function parseIssueTemplateConfig(raw: string): { blankIssuesEnabled: boolean } {
    try {
        const doc = parseYaml(raw)
        const obj = asRecord(doc)
        return { blankIssuesEnabled: obj.blank_issues_enabled !== false }
    } catch {
        return { blankIssuesEnabled: true }
    }
}
