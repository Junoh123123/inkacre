import {extraFunctions,formulaExtra,isText,textValue} from './formula-values.mjs';
import { WorkspaceError } from './contracts.mjs';

const precedence = { '||': 1, or: 1, '&&': 2, and: 2, '==': 3, '!=': 3,
  '>': 4, '>=': 4, '<': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '^':7 };
const functions = new Set(['if', 'ifs', 'let', 'lets', 'empty', 'sum', 'min', 'max', 'abs', 'round', 'length', 'concat', 'count',
  'contains', 'includes', 'lower', 'upper', 'trim', 'substring', 'join', 'split', 'parseDate', 'formatDate', 'dateBetween', 'now', 'dateStart', 'dateEnd',
  'map','filter','find','findIndex','some','every','sort','reverse','unique','flat','slice','first','last','at','name','id','dateAdd','dateSubtract','today','format','toNumber','replace','replaceAll','test','floor','ceil','sqrt','pow','mod',...extraFunctions]);
export function compileFormula(text, resolveProperty, resolveRelated) {
  const tokens = []; let offset = 0;
  const pattern = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|("(?:[^"\\]|\\.)*")|([A-Za-z_]\w*)|(==|!=|>=|<=|&&|\|\||[.^+*/%<>()!,\-\[\]?:]))/y;
  while (offset < text.length) {
    if (!text.slice(offset).trim()) break;
    pattern.lastIndex = offset; const match = pattern.exec(text);
    if (!match) throw new WorkspaceError('FORMULA_SYNTAX', `수식 위치 ${offset + 1}를 확인하세요.`);
    if (match[1] && !Number.isFinite(Number(match[1]))) throw new WorkspaceError('FORMULA_SYNTAX', '유한한 숫자 리터럴이 필요합니다.');
    tokens.push(match[1] ? { literal: Number(match[1]) } : match[2] ? { literal: JSON.parse(match[2]) } : match[3] || match[4]);
    offset = pattern.lastIndex;
  }
  let cursor = 0;
  function expect(value) { if (tokens[cursor++] !== value) throw new WorkspaceError('FORMULA_SYNTAX', `${value}가 필요합니다.`); }
  function expression(min = 0) {
    const token = tokens[cursor++]; let left;
    if (token && typeof token === 'object') left = { type: 'literal', value: token.literal };
    else if (['true', 'false', 'null'].includes(token)) left = { type: 'literal', value: token === 'null' ? null : token === 'true' };
    else if (['-', '!', 'not'].includes(token)) left = { type: 'unary', op: token, arg: expression(7) };
    else if (token === '(') { left = expression(); expect(')'); }
    else if (token === '[') {
      const items = [];
      if (tokens[cursor] !== ']') { do { items.push(expression()); } while (tokens[cursor] === ',' && ++cursor); }
      expect(']'); left = { type: 'list', items };
    }
    else if (typeof token === 'string' && tokens[cursor] === '(') {
      cursor++; const args = [];
      if (tokens[cursor] !== ')') { do { args.push(expression()); } while (tokens[cursor] === ',' && ++cursor); }
      expect(')');
      if (token === 'prop') {
        if (args.length !== 1 || args[0].type !== 'literal' || typeof args[0].value !== 'string') throw new WorkspaceError('FORMULA_SYNTAX', 'prop("속성 이름 또는 ID")를 사용하세요.');
        const propertyId = resolveProperty(args[0].value);
        if (!propertyId) throw new WorkspaceError('FORMULA_REF', `속성을 찾을 수 없습니다: ${args[0].value}`);
        left = { type: 'property', propertyId };
      } else {
        if (!functions.has(token)) throw new WorkspaceError('FORMULA_FUNCTION', `지원하지 않는 함수: ${token}`);
        left = { type: 'call', name: token, args };
      }
    } else if (typeof token === 'string' && /^[A-Za-z_]\w*$/.test(token)) left = { type: 'variable', name: token };
    else throw new WorkspaceError('FORMULA_SYNTAX', '유효한 값 또는 함수를 입력하세요.');
    while(tokens[cursor]==='.') {
      cursor++;const name=tokens[cursor++];expect('(');const args=[];if(tokens[cursor]!==')'){do{args.push(expression())}while(tokens[cursor]===','&&++cursor)}expect(')');
      if(name==='prop'){if(args.length!==1||args[0].type!=='literal'||typeof args[0].value!=='string')throw new WorkspaceError('FORMULA_REF','관계 속성 이름 또는 ID를 입력하세요.');left={type:'related',object:left,ref:args[0].value};}
      else {if(!functions.has(name))throw new WorkspaceError('FORMULA_FUNCTION',`지원하지 않는 함수: ${name}`);left={type:'call',name,args:[left,...args]};}
    }
    while (precedence[tokens[cursor]] !== undefined && precedence[tokens[cursor]] >= min) {
      const op = tokens[cursor++]; left = { type: 'binary', op, left, right: expression(precedence[op] + (op==='^'?0:1)) };
    }
    if (min === 0 && tokens[cursor] === '?') {
      cursor++; const yes = expression(); expect(':');
      left = { type: 'call', name: 'if', args: [left, yes, expression()] };
    }
    return left;
  }
  const result = expression();
  if (cursor !== tokens.length) throw new WorkspaceError('FORMULA_SYNTAX', '수식 뒤의 입력을 확인하세요.');
  function origin(node,bindings){return node?.type==='property'?node.propertyId:node?.type==='related'?node.propertyId:node?.type==='variable'?bindings.get(node.name):node?.type==='call'?origin(node.args[0],bindings):null;}
  function validate(node, scope = new Set(),bindings=new Map()) {
    if(node.type==='related'){
      validate(node.object,scope,bindings);node.propertyId=resolveRelated?.(origin(node.object,bindings),node.ref);
      if(!node.propertyId)throw new WorkspaceError('FORMULA_REF',`관계 대상 속성을 찾을 수 없습니다: ${node.ref}`);delete node.ref;return;
    }
    if(node.type==='call'&&['map','filter','find','findIndex','some','every','sort'].includes(node.name)&&node.args.length===2){
      validate(node.args[0],scope,bindings);const nested=new Set([...scope,'current','index']),mapped=new Map(bindings);mapped.set('current',origin(node.args[0],bindings));validate(node.args[1],nested,mapped);return;
    }
    if (node.type === 'variable' && !scope.has(node.name)) throw new WorkspaceError('FORMULA_VARIABLE', `정의되지 않은 변수: ${node.name}`);
    if (node.type === 'call' && ['let', 'lets'].includes(node.name)) {
      if (node.args.length < 3 || node.args.length % 2 !== 1 || node.name === 'let' && node.args.length !== 3) throw new WorkspaceError('FORMULA_ARITY', 'let/lets에는 변수·값 쌍과 마지막 결과가 필요합니다.');
      const nested = new Set(scope);
      for (let i = 0; i < node.args.length - 1; i += 2) {
        const variable = node.args[i];
        if (variable.type !== 'variable') throw new WorkspaceError('FORMULA_VARIABLE', '변수 이름을 입력하세요.');
        validate(node.args[i + 1], nested,bindings); nested.add(variable.name);bindings=new Map(bindings);bindings.set(variable.name,origin(node.args[i+1],bindings));
      }
      validate(node.args.at(-1), nested,bindings); return;
    }
    for (const child of [node.left, node.right, node.arg, ...node.args ?? [], ...node.items ?? []].filter(Boolean)) validate(child, scope,bindings);
  }
  validate(result);
  return result;
}
export const isEmpty = value => value === null || value === undefined || value === '' || isText(value)&&textValue(value)==='' || (Array.isArray(value) && !value.length);
export function formatFormula(ast) {
  if (ast.type === 'literal') return JSON.stringify(ast.value);
  if (ast.type === 'property') return `prop(${JSON.stringify(ast.propertyId)})`;
  if (ast.type === 'variable') return ast.name;
  if (ast.type === 'related') return `${formatFormula(ast.object)}.prop(${JSON.stringify(ast.propertyId)})`;
  if (ast.type === 'list') return `[${ast.items.map(formatFormula).join(', ')}]`;
  if (ast.type === 'unary') return `${ast.op} (${formatFormula(ast.arg)})`;
  if (ast.type === 'binary') return `(${formatFormula(ast.left)} ${ast.op} ${formatFormula(ast.right)})`;
  if (ast.type === 'call') return `${ast.name}(${ast.args.map(formatFormula).join(', ')})`;
  throw new WorkspaceError('FORMULA_SYNTAX', '수식 구조를 확인하세요.');
}
function number(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new WorkspaceError('FORMULA_TYPE', '숫자 값이 필요합니다.');
  return value;
}
function date(value) {
  if (!value || typeof value.start !== 'string' || !Number.isFinite(Date.parse(value.start))) throw new WorkspaceError('FORMULA_DATE', '유효한 날짜 값이 필요합니다.');
  return new Date(value.start);
}
function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) throw new WorkspaceError('FORMULA_DATE', 'ISO 날짜 또는 시각을 입력하세요.');
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(Date.parse(value))) throw new WorkspaceError('FORMULA_DATE', '존재하지 않는 날짜입니다.');
  return { start: value };
}
function formatDate(value, pattern) {
  const parsed = date(value);
  if (typeof pattern !== 'string') throw new WorkspaceError('FORMULA_TYPE', '날짜 표시 형식이 필요합니다.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: value.start.length === 10 ? 'UTC' : value.timeZone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(parsed).map(part => [part.type, part.value]));
  const tokens = { YYYY: parts.year, YY: parts.year.slice(-2), MM: parts.month, M: String(Number(parts.month)), DD: parts.day, D: String(Number(parts.day)), HH: parts.hour, H: String(Number(parts.hour)), mm: parts.minute, m: String(Number(parts.minute)), ss: parts.second, s: String(Number(parts.second)) };
  const timeZone=value.start.length===10?'UTC':value.timeZone??'UTC';
  Object.assign(tokens,{MMMM:new Intl.DateTimeFormat('en',{timeZone,month:'long'}).format(parsed),MMM:new Intl.DateTimeFormat('en',{timeZone,month:'short'}).format(parsed),dddd:new Intl.DateTimeFormat('en',{timeZone,weekday:'long'}).format(parsed),ddd:new Intl.DateTimeFormat('en',{timeZone,weekday:'short'}).format(parsed),h:String(Number(parts.hour)%12||12),hh:String(Number(parts.hour)%12||12).padStart(2,'0'),A:Number(parts.hour)<12?'AM':'PM',a:Number(parts.hour)<12?'am':'pm'});
  return pattern.replace(/\[[^\]]*\]|[A-Za-z]+/g, token => {
    if (token.startsWith('[')) return token.slice(1, -1);
    if (!(token in tokens)) throw new WorkspaceError('FORMULA_DATE_FORMAT', `지원하지 않는 날짜 표시 형식: ${token}`);
    return tokens[token];
  });
}
function addDate(value,amount,unit) {
  const start=date(value),floating=value.start.length===10;
  const move=text=>{const d=new Date(text);if(['months','years','quarters'].includes(unit)){const day=d.getUTCDate();d.setUTCDate(1);if(unit==='years')d.setUTCFullYear(d.getUTCFullYear()+amount);else d.setUTCMonth(d.getUTCMonth()+amount*(unit==='quarters'?3:1));d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));}
    else {const ms={minutes:60000,hours:3600000,days:86400000,weeks:604800000}[unit];if(!ms)throw new WorkspaceError('FORMULA_DATE_UNIT','지원하지 않는 날짜 단위입니다.');d.setTime(d.getTime()+amount*ms)}return d.toISOString().slice(0,floating?10:undefined)};
  return {...value,start:move(value.start),...(value.end?{end:move(value.end)}:{})};
}
export function evaluateFormula(ast, readProperty, { now = new Date().toISOString(), readRelated, pageId } = {}) {
  function evaluate(node, depth = 0, scope = new Map()) {
    if (depth > 100) throw new WorkspaceError('FORMULA_DEPTH', '수식 깊이 제한을 넘었습니다.');
    const next = n => evaluate(n, depth + 1, scope);
    if (node.type === 'literal') return node.value;
    if (node.type === 'property') return readProperty(node.propertyId);
    if(node.type==='related'){if(!readRelated)throw new WorkspaceError('FORMULA_REF','관계 대상 읽기가 필요합니다.');return readRelated(next(node.object),node.propertyId);}
    if (node.type === 'list') return node.items.map(next);
    if (node.type === 'variable') {
      if (!scope.has(node.name)) throw new WorkspaceError('FORMULA_VARIABLE', `정의되지 않은 변수: ${node.name}`);
      return scope.get(node.name);
    }
    if (node.type === 'unary') return node.op === '-' ? -number(next(node.arg)) : !next(node.arg);
    if (node.type === 'binary') {
      const a = next(node.left);
      if (['&&', 'and'].includes(node.op)) return Boolean(a) && Boolean(next(node.right));
      if (['||', 'or'].includes(node.op)) return Boolean(a) || Boolean(next(node.right));
      const b = next(node.right),comparable=value=>value?.start?Date.parse(value.start):isText(value)?textValue(value):value;
      if(node.op==='+'&&(isText(a)||isText(b)))return {type:'formatted_text',richText:[...(isText(a)?a.richText:[{text:textValue(a)}]),...(isText(b)?b.richText:[{text:textValue(b)}])]};
      switch (node.op) {
        case '+': return typeof a === 'string' && typeof b === 'string' ? a + b : number(a) + number(b);
        case '-': return number(a) - number(b);
        case '*': return number(a) * number(b);
        case '^': return Math.pow(number(a),number(b));
        case '/': if (!number(b)) throw new WorkspaceError('FORMULA_DIV0', '0으로 나눌 수 없습니다.'); return number(a) / number(b);
        case '%': if (!number(b)) throw new WorkspaceError('FORMULA_DIV0', '0으로 나눌 수 없습니다.'); return number(a) % number(b);
        case '==': return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
        case '!=': return JSON.stringify(comparable(a)) !== JSON.stringify(comparable(b));
        case '>': return comparable(a)>comparable(b);case '>=':return comparable(a)>=comparable(b);case '<':return comparable(a)<comparable(b);case '<=':return comparable(a)<=comparable(b);
      }
    }
    if (node.type === 'call') {
      if(['map','filter','find','findIndex','some','every','sort'].includes(node.name)&&node.args.length===2){
        const list=next(node.args[0]);if(!Array.isArray(list))throw new WorkspaceError('FORMULA_TYPE','목록이 필요합니다.');
        const values=list.map((current,index)=>evaluate(node.args[1],depth+1,new Map([...scope,['current',current],['index',index]])));
        if(node.name==='map')return values;if(node.name==='filter')return list.filter((_,i)=>values[i]);if(node.name==='find')return list[values.findIndex(Boolean)]??null;if(node.name==='findIndex')return values.findIndex(Boolean);if(node.name==='some')return values.some(Boolean);if(node.name==='every')return values.every(Boolean);
        return list.map((value,i)=>({value,key:values[i]})).sort((a,b)=>typeof a.key==='number'&&typeof b.key==='number'?a.key-b.key:String(a.key).localeCompare(String(b.key))).map(x=>x.value);
      }
      if (node.name === 'if') { if (node.args.length !== 3) throw new WorkspaceError('FORMULA_ARITY', 'if는 세 인수가 필요합니다.'); return next(node.args[0]) ? next(node.args[1]) : next(node.args[2]); }
      if (node.name === 'ifs') {
        if(node.args.length<2)throw new WorkspaceError('FORMULA_ARITY','ifs에는 조건·결과 쌍이 필요합니다.');
        for(let i=0;i+1<node.args.length;i+=2)if(next(node.args[i]))return next(node.args[i+1]);
        return node.args.length%2?next(node.args.at(-1)):null;
      }
      if (['let', 'lets'].includes(node.name)) {
        const nested = new Map(scope);
        for (let i = 0; i < node.args.length - 1; i += 2) nested.set(node.args[i].name, evaluate(node.args[i + 1], depth + 1, nested));
        return evaluate(node.args.at(-1), depth + 1, nested);
      }
      const args = node.args.map(next), flat = args.flat();
      if(node.name==='fromTimestamp'){const ms=number(args[0]);if(!Number.isFinite(new Date(ms).getTime()))throw new WorkspaceError('FORMULA_DATE','timestamp 범위를 확인하세요.');return {start:new Date(Math.trunc(ms/60000)*60000).toISOString()};}
      const extra=formulaExtra(node.name,args);if(extra.handled)return extra.value;
      switch (node.name) {
        case 'empty': return isEmpty(args[0]) || args[0] === 0;
        case 'sum': return flat.reduce((sum, value) => sum + number(value), 0);
        case 'count': return flat.length;
        case 'min': return flat.length ? Math.min(...flat.map(number)) : null;
        case 'max': return flat.length ? Math.max(...flat.map(number)) : null;
        case 'abs': return Math.abs(number(args[0]));
        case 'round': return Math.round(number(args[0]) * 10 ** number(args[1] ?? 0)) / 10 ** number(args[1] ?? 0);
        case 'length': return isText(args[0])?textValue(args[0]).length:args[0]?.length??0;
        case 'concat': return args.every(Array.isArray) ? flat : args.map(value => String(value ?? '')).join('');
        case 'contains': case 'includes': return Array.isArray(args[0]) ? args[0].some(value => JSON.stringify(value) === JSON.stringify(args[1])) : textValue(args[0]).includes(textValue(args[1]));
        case 'lower': return textValue(args[0]).toLowerCase();
        case 'upper': return textValue(args[0]).toUpperCase();
        case 'trim': return textValue(args[0]).trim();
        case 'substring': return textValue(args[0]).slice(number(args[1]), args[2] === undefined ? undefined : number(args[2]));
        case 'join': if (!Array.isArray(args[0])) throw new WorkspaceError('FORMULA_TYPE', 'join에는 목록이 필요합니다.'); return args[0].map(v=>isText(v)?textValue(v):v).join(textValue(args[1]));
        case 'split': return textValue(args[0]).split(textValue(args[1]));
        case 'first': return args[0]?.[0]??null;
        case 'last': return args[0]?.at(-1)??null;
        case 'at': return args[0]?.at(number(args[1]))??null;
        case 'slice': return args[0]?.slice(number(args[1]),args[2]===undefined?undefined:number(args[2]))??[];
        case 'reverse': if(!Array.isArray(args[0]))throw new WorkspaceError('FORMULA_TYPE','목록이 필요합니다.');return [...args[0]].reverse();
        case 'sort': if(!Array.isArray(args[0]))throw new WorkspaceError('FORMULA_TYPE','목록이 필요합니다.');return [...args[0]].sort((a,b)=>typeof a==='number'&&typeof b==='number'?a-b:String(a).localeCompare(String(b)));
        case 'unique': if(!Array.isArray(args[0]))throw new WorkspaceError('FORMULA_TYPE','목록이 필요합니다.');return [...new Map(args[0].map(v=>[JSON.stringify(v),v])).values()];
        case 'flat': if(!Array.isArray(args[0]))throw new WorkspaceError('FORMULA_TYPE','목록이 필요합니다.');return args[0].flat();
        case 'name': return readRelated?.(args[0]??pageId,'$title')??String(args[0]??'');
        case 'id': return String(args[0]??pageId??'');
        case 'today': return {start:now.slice(0,10)};
        case 'format': return isText(args[0])?textValue(args[0]):typeof args[0]==='object'?JSON.stringify(args[0]):String(args[0]??'');
        case 'toNumber': {const result=Number(isText(args[0])?textValue(args[0]):args[0]);if(!Number.isFinite(result))throw new WorkspaceError('FORMULA_TYPE','숫자로 바꿀 수 없습니다.');return result;}
        case 'floor': return Math.floor(number(args[0]));case 'ceil':return Math.ceil(number(args[0]));case 'sqrt':return Math.sqrt(number(args[0]));case 'pow':return Math.pow(number(args[0]),number(args[1]));
        case 'mod':if(!number(args[1]))throw new WorkspaceError('FORMULA_DIV0','0으로 나눌 수 없습니다.');return number(args[0])%number(args[1]);
        case 'replace':case 'replaceAll':case 'test': {
          if(String(args[0]).length>4096||String(args[1]).length>256)throw new WorkspaceError('FORMULA_LIMIT','정규식 입력이 너무 깁니다.');
          if(/\\[1-9]|[()|]/.test(String(args[1]))||(String(args[1]).match(/[+*{]/g)??[]).length>1)throw new WorkspaceError('FORMULA_REGEX','그룹·역참조·복수 반복 정규식은 지원하지 않습니다.');
          let regex;try{regex=new RegExp(String(args[1]),node.name==='replaceAll'?'g':'')}catch{throw new WorkspaceError('FORMULA_REGEX','정규식을 확인하세요.')}return node.name==='test'?regex.test(String(args[0]??'')):String(args[0]??'').replace(regex,String(args[2]??''));
        }
        case 'dateAdd':case 'dateSubtract':return addDate(args[0],number(args[1])*(node.name==='dateSubtract'?-1:1),args[2]);
        case 'parseDate': return parseDate(args[0]);
        case 'now': return { start: now };
        case 'dateStart': date(args[0]); return { start: args[0].start, ...(args[0].timeZone ? { timeZone: args[0].timeZone } : {}) };
        case 'dateEnd': date(args[0]); return { start: args[0].end ?? args[0].start, ...(args[0].timeZone ? { timeZone: args[0].timeZone } : {}) };
        case 'formatDate': return formatDate(args[0], args[1]);
        case 'dateBetween': {
          if(['months','quarters','years'].includes(args[2])){const a=date(args[0]),b=date(args[1]),sign=a>=b?1:-1,from=sign>0?args[1]:args[0],to=sign>0?a:b;let months=(to.getUTCFullYear()-date(from).getUTCFullYear())*12+to.getUTCMonth()-date(from).getUTCMonth();if(date(addDate(from,months,'months'))>to)months--;return sign*Math.trunc(months/(args[2]==='years'?12:args[2]==='quarters'?3:1))||0;}
          const unit = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 }[args[2]];
          if (!unit) throw new WorkspaceError('FORMULA_DATE_UNIT', '날짜 단위는 minutes/hours/days/weeks/months/quarters/years입니다.');
          return Math.trunc((date(args[0]) - date(args[1])) / unit);
        }
      }
    }
    throw new WorkspaceError('FORMULA_SYNTAX', '유효하지 않은 수식입니다.');
  }
  const value = evaluate(ast);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new WorkspaceError('FORMULA_NUMBER', '계산 결과가 유한한 숫자가 아닙니다.');
  return value;
}
