import { readFileSync } from 'node:fs';
import { is } from 'css-select';
import { Element } from 'domhandler';
import postcss, { type Declaration, type Rule } from 'postcss';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');
const stylesheet = postcss.parse(css);

type Specificity = [number, number, number];

function specificity(selector: string): Specificity {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const classes = selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)?.length ?? 0;
  const types = selector.match(/(?:^|[\s>+~])(?:button|label)(?=[.#[:]|$)/g)?.length ?? 0;
  return [ids, classes, types];
}

function after(a: Specificity, b: Specificity): boolean {
  return a[0] > b[0]
    || (a[0] === b[0] && a[1] > b[1])
    || (a[0] === b[0] && a[1] === b[1] && a[2] >= b[2]);
}

/** The author cascade over `display`, with the browser's `[hidden]` default. */
function display(element: Element): string {
  let value = Object.hasOwn(element.attribs, 'hidden') ? 'none' : 'initial';
  let winning: Specificity | null = null;

  stylesheet.walkRules((rule: Rule) => {
    const declarations = rule.nodes.filter(
      (node): node is Declaration => node.type === 'decl' && node.prop === 'display',
    );
    if (!declarations.length) return;
    for (const selector of rule.selectors) {
      if (!is(element, selector)) continue;
      const candidate = specificity(selector);
      for (const declaration of declarations) {
        if (winning === null || after(candidate, winning)) {
          winning = candidate;
          value = declaration.value;
        }
      }
    }
  });
  return value;
}

it('renders exactly one directory control as hidden is toggled', () => {
  const directory = new Element('button', { id: 'pickDir', hidden: '' });
  const upload = new Element('label', { id: 'pickUploadLabel', class: 'button' });
  const actions = new Element('div', { class: 'pick-actions' }, [directory, upload]);
  directory.parent = actions;
  upload.parent = actions;

  expect([display(directory), display(upload)]).toEqual(['none', 'inline-flex']);

  delete directory.attribs.hidden;
  upload.attribs.hidden = '';
  expect([display(directory), display(upload)]).toEqual(['inline-flex', 'none']);
});
