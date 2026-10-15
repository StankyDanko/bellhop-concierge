// Form fields bound to the draft config by path ("property.name", "picks.0.why").
// Labels sit above fields, help and errors below and linked by aria-describedby.
import { useId } from 'react';
import { Icon } from '../icons.jsx';

export const MASK = '(hidden)';

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const out = structuredClone(obj);
  let o = out;
  keys.slice(0, -1).forEach((k, i) => {
    if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  });
  o[keys.at(-1)] = value;
  return out;
}

/** "picks.0.why" -> "picks[0].why", the shape config/schema.js uses in its error messages. */
export const errKey = (path) => path.replace(/\.(\d+)(?=\.|$)/g, '[$1]');

function Described({ id, help, error }) {
  return (
    <>
      {help && <p className="help" id={`${id}-help`}>{help}</p>}
      {error && <p className="err" id={`${id}-err`}><Icon name="warn" width="16" height="16" />{error}</p>}
    </>
  );
}

const describedBy = (id, help, error) => [help && `${id}-help`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;

export function TextField({ ctx, path, label, help, multiline, type = 'text', inputMode, autoComplete = 'off', placeholder, required, maxLength }) {
  const id = useId();
  const error = ctx.errors[errKey(path)];
  const raw = getPath(ctx.draft, path);
  const value = raw ?? '';
  const props = {
    id, value, placeholder, required, maxLength,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy(id, help, error),
    onChange: (e) => ctx.update(path, type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value),
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required && <span className="dim"> (needed)</span>}</label>
      {multiline
        ? <textarea className="textarea" rows={3} {...props} />
        : <input className="input" type={type} inputMode={inputMode} autoComplete={autoComplete} step={type === 'number' ? 'any' : undefined} {...props} />}
      <Described id={id} help={help} error={error} />
    </div>
  );
}

/** One item per line, stored as an array. Empty lines are dropped when the config is sent. */
export function LinesField({ ctx, path, label, help, placeholder }) {
  const id = useId();
  const error = ctx.errors[errKey(path)] ?? Object.entries(ctx.errors).find(([k]) => k.startsWith(`${errKey(path)}[`))?.[1];
  const arr = getPath(ctx.draft, path) ?? [];
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} className="textarea" rows={4} placeholder={placeholder} value={arr.join('\n')}
        aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy(id, help, error)}
        onChange={(e) => ctx.update(path, e.target.value.split('\n'))} />
      <Described id={id} help={help} error={error} />
    </div>
  );
}

/** Door and wifi notes: masked, never spoken, sent only by text to the booking phone. */
export function SecretField({ ctx, path, label, help }) {
  const id = useId();
  const error = ctx.errors[errKey(path)];
  const raw = getPath(ctx.draft, path) ?? '';
  const hidden = raw === MASK;
  return (
    <div className="field">
      <label htmlFor={id}>{label} <span className="prov secret"><Icon name="lock" />Never spoken aloud</span></label>
      <input id={id} className="input" type="password" autoComplete="off" spellCheck={false}
        value={hidden ? '' : raw}
        placeholder={hidden ? "Hidden. Leave blank to keep the sample inn's note." : ''}
        aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy(id, help, error)}
        onChange={(e) => ctx.update(path, e.target.value)} />
      <Described id={id} help={help} error={error} />
    </div>
  );
}

/** Repeating group (picks, avoid list, FAQ). Each item is a small fieldset. */
export function ListEditor({ ctx, path, max, itemLabel, blank, render, addLabel }) {
  const items = getPath(ctx.draft, path) ?? [];
  const listErr = ctx.errors[errKey(path)];
  return (
    <div className="list-editor">
      {items.map((item, i) => (
        // Items have no stable id; index keys are acceptable because rows are only appended or removed from a button in the row.
        // eslint-disable-next-line react/no-array-index-key
        <fieldset className="fieldset list-item" key={i}>
          <legend>{itemLabel} {i + 1}</legend>
          {render(i)}
          <button type="button" className="btn btn-text" onClick={() => ctx.update(path, items.filter((_, j) => j !== i))}>
            <Icon name="x" />Remove {itemLabel.toLowerCase()} {i + 1}
          </button>
        </fieldset>
      ))}
      {listErr && <p className="err" role="alert"><Icon name="warn" width="16" height="16" />{listErr}</p>}
      <div className="row">
        <button type="button" className="btn btn-quiet" disabled={items.length >= max} onClick={() => ctx.update(path, [...items, structuredClone(blank)])}>
          <Icon name="plus" />{addLabel}
        </button>
        <span className="micro mono tnum">{items.length} of {max}</span>
      </div>
    </div>
  );
}

/** Native radios styled as a segmented control. */
export function Segmented({ name, legend, options, value, onChange, describedBy: db }) {
  return (
    <fieldset className="fieldset">
      <legend>{legend}</legend>
      <div className="segmented" aria-describedby={db}>
        {options.map((o) => (
          <label key={o.value}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Switch({ label, consequence, checked, onChange }) {
  const id = useId();
  return (
    <div className="switch-row">
      <div>
        <label htmlFor={id} style={{ fontWeight: 500 }}>{label}</label>
        <p className="dim" id={`${id}-c`} style={{ fontSize: 'var(--text-sm)' }}>{consequence}</p>
      </div>
      <span className="switch">
        <input id={id} type="checkbox" role="switch" checked={checked} aria-describedby={`${id}-c`} onChange={(e) => onChange(e.target.checked)} />
        <span className="track" aria-hidden="true" />
        <span aria-hidden="true">{checked ? 'On' : 'Off'}</span>
      </span>
    </div>
  );
}
