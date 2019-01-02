import * as path from 'path';
import * as fs from 'fs';
import * as MarkdownIt from 'markdown-it';
const yamlFront = require('yaml-front-matter');

import { Directive, DirectiveProperty, InputAttrType } from '../../../src/magic/interfaces';
import { AST, AST_KEYS } from './ast';

const COG = {
  /** 额外有效组件名清单 */
  VALID_COMPONENT_NAMES: ['th', 'td', 'thead'],
  /** 同时拥有组件与指令能力清单 */
  COMPONET_AND_DIRECTIVE: ['se-container', 'se-title', 'error-collect', 'sg-container', 'sv-container', 'sv-title', 'sf'],
  /** 被拆分多个表格属性的组件清单 */
  SPLIT_PROPERTIES: ['th', 'td'],
  /** 忽略组件 */
  INGORE_COMPONENTS: ['nz-icon'],
  /** 忽略属性清单 */
  INGORE_PROPERTIES: ['ng-content'],
  /** 忽略属性对象清单 */
  INGORE_PROPERTI_OBJECT: ['data'],
  /** 已知无效组件变更 */
  INVALID_COMPONENTS: {
    'nz-tr': 'tr'
  },
  MERGE_PROPERTIES: {
    'nz-date-picker': { 'zh': '共同的 API', 'en': 'Common API' },
    'nz-year-picker': { 'zh': '共同的 API', 'en': 'Common API' },
    'nz-month-picker': { 'zh': '共同的 API', 'en': 'Common API' },
    'nz-range-picker': { 'zh': '共同的 API', 'en': 'Common API' },
    'nz-week-picker': { 'zh': '共同的 API', 'en': 'Common API' },
  }
};
const md = new MarkdownIt();
let ast: AST;

export function makeObject(lang: string, filePaths: string[]): Directive[] {
  const zone = lang.split('-').shift();
  const res = [];
  filePaths.forEach(p => {
    const content = fs.readFileSync(p).toString();
    const meta = yamlFront.loadFront(content);
    meta.md = md.parse(meta.__content, {});
    delete meta.__content;
    res.push(...metaToItem(zone, p, meta));
  });
  return res;
}

function getLibary(filePath: string) {
  const parts = path.dirname(filePath).split(path.sep);
  if (parts.includes('ng-zorro-antd')) {
    return 'ng-zorro-antd';
  } else if (parts.includes('abc')) {
    return '@delon/abc';
  } else if (parts.includes('chart')) {
    return '@delon/chart';
  } else if (parts.includes('form')) {
    return '@delon/form';
  }
  return '';
}

function getUrl(zone: string, filePath: string) {
  const parts = path.dirname(filePath).split(path.sep);
  let last = parts.pop();
  if (last === 'doc') last = parts.pop();
  if (parts.includes('ng-zorro-antd')) {
    return `https://ng.ant.design/components/${last}/${zone}`;
  } else if (parts.includes('abc')) {
    return `https://ng-alain.com/components/${last}/${zone}`;
  } else if (parts.includes('chart')) {
    return `https://ng-alain.com/chart/${last}/${zone}`;
  } else if (parts.includes('form')) {
    return `https://ng-alain.com/form/getting-started/${zone}`;
  }
  return '';
}

function getTitle(meta: any): string {
  const title = meta.subtitle || meta.title;
  if (typeof title === 'object') {
    return title[Object.keys(title)[0]];
  }
  return title || '';
}

function getDirective(): Directive[] {
  const start = ast.offsetAt('API');
  if (start === -1) return [];
  const end = ast.offsetTagAndTypeAt(AST_KEYS.HeadingClose, 'h2', start + 3);

  const list: Directive[] = ast
    .findTags('h3', start + 1, end)
    .map(idx => {
      const selectorList = (ast.getText(idx) || '').split('|').map(s => s.trim());
      let selector = selectorList[0];
      if (selectorList.length === 1 && !/^\[?[a-z][-a-z0-9]+\]?$/g.test(selector) && !COG.VALID_COMPONENT_NAMES.includes(selector)) {
        return null;
      }
      if (COG.INVALID_COMPONENTS[selector]) {
        selector = COG.INVALID_COMPONENTS[selector];
      }

      const item: Directive = {
        _idx: idx,
        type: 'component',
        selector,
        properties: getProperties(ast.getTable(idx, COG.SPLIT_PROPERTIES.includes(selector))),
      };
      const checkType = (i: Directive) => {
        if (i.selector.startsWith('[')) {
          i.type = 'directive';
          i.selector = cleanTag(i.selector, '[');
        }
      }
      // fix muliter selector
      if (selectorList.length > 1) {
        const directives: Directive[] = [];
        selectorList.forEach(sel => {
          const copyItem = copy(item) as Directive;
          copyItem.selector = sel;
          checkType(copyItem);
          directives.push(copyItem);
        });
        return directives;
      } else {
        checkType(item);
      }
      // merge properties
      if (COG.MERGE_PROPERTIES[item.selector]) {
        const commonHeading = COG.MERGE_PROPERTIES[item.selector][ast.zone];
        const commonIdx = ast.offsetAt(commonHeading);
        const commonProperties = getProperties(ast.getTable(commonIdx, false));
        item.properties = commonProperties.concat(...item.properties);
      }
      // fix description
      const descriptionStart = ast.offsetTagAndTypeAt(AST_KEYS.ParagraphOpen, 'p', idx + 1);
      // 若未找到 table，则尝试获取第一个段落
      if (descriptionStart !== -1 && descriptionStart < ast.offsetTagAt('table', idx + 1)) {
        item.description = ast.getText(descriptionStart);
      } else if (ast.length > (idx + 3) && ast.isParagraph(idx + 3)) {
        item.description = ast.getText(idx + 3);
      }
      return item;
    })
    .reduce((p: any, c: any) => p = p.concat(...(Array.isArray(c) ? c : [c])), []);

  return list.filter(i => !!i && !COG.INGORE_COMPONENTS.includes(i.selector));
}

function getProperties(data: string[][]): DirectiveProperty[] {
  return data
    .filter(tds => tds.length === 4)
    .map(tds => genPropertyItem(tds.map(v => v || '')))
    .filter(w => !!w);
}

function genPropertyItem(data: string[]): DirectiveProperty {
  if (COG.INGORE_PROPERTIES.includes(data[0])) return null;
  const nameMatch = data[0].trim().match(/((?:\[|\(|\[\()[\-a-zA-Z]+(?:\)\]|\]|\)))/g);
  if (nameMatch.length === 0) return null;

  const item: DirectiveProperty = {
    name: nameMatch[0],
    inputType: InputAttrType.Input,
    description: data[1].trim(),
    type: 'string',
    typeRaw: cleanTag(data[2].trim()).replace(/丨/g, '|'),
    default: data[3].trim(),
  };

  // name
  if (item.name.startsWith('[')) {
    item.name = cleanTag(item.name, '[');
  } else if (item.name.startsWith('(')) {
    item.name = cleanTag(item.name, '(');
    item.inputType = InputAttrType.Output;
  } else if (item.name.startsWith('[(')) {
    item.name = cleanTag(item.name, '[(');
    item.inputType = InputAttrType.InputOutput;
  } else if (item.name.startsWith('#')) {
    item.name = item.name.substr(1);
    item.inputType = InputAttrType.Template;
  }
  // type
  let types: any = item.typeRaw;
  if (types.startsWith('Enum')) {
    types = cleanTag(types.substr(4), '{');
  }
  types = types.split(~types.indexOf(',') ? ',' : '丨')
    .map(v => cleanTag(v))
    .map(v => cleanSemicolon(v));
  const firstType = types.length > 0 ? types[0].split(' ').shift() : '';

  if (firstType.startsWith('TemplateRef')) {
    item.type = 'TemplateRef';
  } else if (firstType.startsWith('(')) {
    item.type = 'function';
  } else if (firstType.startsWith('{')) {
    item.type = 'object';
  } else if (firstType.startsWith('EventEmitter')) {
    item.type = 'EventEmitter';
  } else if (firstType.startsWith('Array')) {
    item.type = 'Array';
  } else if (firstType.startsWith('Enum')) {
    item.type = 'Enum';
  } else {
    switch (firstType) {
      case 'boolean':
        item.type = 'boolean';
        break;
      case 'number':
        item.type = 'number';
        break;
      case 'Date':
        item.type = 'Date';
        break;
      case 'HTMLElement':
        item.type = 'HTMLElement';
        break;
    }
  }

  // type definition
  if (
    item.type === 'Enum' ||
    (item.type === 'string'
      && types.length > 1
      && !types.includes('any')
      && !types.includes('string')
      && !types.includes('EventEmitter')
      && !types.includes('HTMLElement'))
  ) {
    if (item.type === 'Enum') {

    }
    item.typeDefinition = types
      .filter(value => !!value)
      .filter(value => value !== 'null')
      .map(value => ({ value, label: value }));
  }

  // default
  if (['`-`', '-', '`无`', '无'].includes(item.default)) {
    item.default = '';
  }

  // ngModel
  if (
    item.name === 'ngModel'
    || item.description.includes('双向绑定')
    || item.description.includes('double binding')
    || item.description.includes('Two-way')
  ) {
    item.inputType = InputAttrType.InputOutput;
  }

  if (!/^[-a-zA-Z0-9]+$/.test(item.name)) return null;

  return item;
}

function cleanTag(text: string, tag = '`'): string {
  if (text.startsWith(tag)) {
    text = text.substr(tag.length, text.length - (tag.length * 2));
  }
  return text.trim();
}

function cleanSemicolon(text: string): string {
  if (text.startsWith(`'`) || text.startsWith(`"`)) {
    text = text.substr(1);
  }
  if (text.endsWith(`'`) || text.endsWith(`"`)) {
    text = text.substr(0, text.length - 1);
  }
  return text.trim();
}

function copy(obj: any): any {
  return JSON.parse(JSON.stringify(obj));
}

function metaToItem(zone: string, filePath: string, meta: any): Directive[] {
  ast = new AST(meta.md, filePath, zone);
  const url = getUrl(zone, filePath);
  const lib = getLibary(filePath);
  const title = getTitle(meta);
  const description = ast.getText(0);
  const whenToUse = ast.getParagraph(zone === 'en' ? 'When To Use' : '何时使用');
  const list: Directive[] = [];
  getDirective().filter(w => !!w).forEach(i => {
    list.push(copy(i));
    if (i.type === 'component' && COG.COMPONET_AND_DIRECTIVE.includes(i.selector)) {
      const directive = copy(i) as Directive;
      directive.type = 'directive';
      list.push(directive);
    }
  });

  return list.map((i) => {
    i.lib = lib;
    i.title = title;
    if (typeof i.description === 'undefined') {
      i.description = description;
    }
    i.whenToUse = whenToUse;
    i.doc = url;
    return i;
  });
}
