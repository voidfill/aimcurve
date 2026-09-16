import { readFileSync } from 'node:fs';
import { is } from 'css-select';
import { Element } from 'domhandler';
import postcss, { type Declaration, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');
const stylesheet = postcss.parse(css);

function declarationsFor(element: Element): Map<string, string> {
  const out = new Map<string, string>();
  stylesheet.walkRules((rule: Rule) => {
    if (!rule.selector.includes('.repick') || rule.selector.includes(':hover')) return;
    if (!rule.selectors.some((selector) => is(element, selector))) return;
    for (const node of rule.nodes) {
      if (node.type === 'decl') out.set((node as Declaration).prop, node.value);
    }
  });
  return out;
}

function repick(stale: '0' | '1'): Element {
  return new Element('button', { class: 'repick', 'data-stale': stale });
}

describe('re-pick staleness treatment', () => {
  it('keeps a fresh snapshot muted and borderless', () => {
    const style = declarationsFor(repick('0'));

    expect(style.get('color')).toBe('var(--faint)');
    expect(style.get('border-color')).toBe('transparent');
  });

  it('uses the down-state accent when the snapshot is stale', () => {
    const style = declarationsFor(repick('1'));

    expect(style.get('color')).toBe('var(--bad)');
    expect(style.get('border-color')).toContain('var(--bad)');
    expect(style.get('animation')).toBeUndefined();
  });
});
