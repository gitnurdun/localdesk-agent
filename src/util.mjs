import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const id = () => crypto.randomUUID();
export const hash = text => crypto.createHash('sha256').update(text).digest('hex');
export const clip = (text, length = 4000) => String(text).length > length ? String(text).slice(0,length) + '\n[truncated; use a narrower query or an offset]' : String(text);
export async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file,'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export async function writeJSON(file, data) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temp = `${file}.${id()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data,null,2),'utf8');
  // Windows scanners or a concurrent reader can briefly hold the destination.
  // Keep the atomic replacement and retry sharing violations, never truncate it.
  for(let attempt=0;;attempt++){try{await fs.rename(temp,file);break;}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=9)throw e;await new Promise(r=>setTimeout(r,15*(attempt+1)));}}
}
export async function appendJSON(file, data) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.appendFile(file,JSON.stringify(data)+'\n','utf8');
}
export function validate(schema, value, at='args') {
  if (schema.anyOf) {
    if (!schema.anyOf.some(s => { try { validate(s,value,at); return true; } catch { return false; } })) throw Error(`${at} does not match the required schema`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) throw Error(`${at} must be one of ${schema.enum.join(', ')}`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${at} must be an object`);
    for (const k of schema.required ?? []) if (!(k in value)) throw Error(`${at}.${k} is required`);
    for (const k of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties ?? {},k)) { if (schema.additionalProperties === false) throw Error(`${at}.${k} is not allowed`); }
      else validate(schema.properties[k],value[k],`${at}.${k}`);
    }
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw Error(`${at} must be an array`);
    if (value.length > (schema.maxItems ?? 100) || value.length < (schema.minItems ?? 0)) throw Error(`${at}: wrong number of items`);
    value.forEach((v,i) => validate(schema.items,v,`${at}[${i}]`));
  }
  if (schema.type === 'string' && (typeof value !== 'string' || value.length > (schema.maxLength ?? 50000) || value.length < (schema.minLength ?? 0))) throw Error(`${at} must be a string of valid length`);
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw Error(`${at} must be boolean`);
  if (schema.type === 'number' && !Number.isFinite(value)) throw Error(`${at} must be a finite number`);
  if (schema.type === 'integer' && (!Number.isInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw Error(`${at} must be an integer in range`);
}
export const str = (description='',maxLength=4000) => ({type:'string',description,maxLength});
export const int = (minimum,maximum,description='') => ({type:'integer',minimum,maximum,description});
export const choice = (...values) => ({type:'string',enum:values});
export const obj = (properties,required=Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false});
export const list = (items,maxItems=20) => ({type:'array',items,maxItems});
