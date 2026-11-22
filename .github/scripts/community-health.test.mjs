import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// GitHub only inherits default issue templates from .github/ISSUE_TEMPLATE in the .github repository.
const templateDir = '.github/ISSUE_TEMPLATE';

test('default issue templates live where GitHub inherits them', () => {
  assert.ok(fs.statSync(templateDir).isDirectory(), templateDir);
  for (const ignored of ['ISSUE_TEMPLATE', 'docs/ISSUE_TEMPLATE']) {
    assert.equal(fs.existsSync(ignored), false, `${ignored} is not inherited by other repositories`);
  }
});

test('default issue templates declare the front matter the chooser needs', () => {
  const templates = fs.readdirSync(templateDir).filter(name => name.endsWith('.md'));
  assert.ok(templates.length > 0, 'no default issue templates');
  for (const name of templates) {
    const front = fs.readFileSync(`${templateDir}/${name}`, 'utf8').match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(front, `${name} has no front matter`);
    assert.match(front[1], /^name: \S/m, `${name} name`);
    assert.match(front[1], /^about: \S/m, `${name} about`);
  }
});

test('issue chooser config links to files that exist in this repository', () => {
  const config = fs.readFileSync(`${templateDir}/config.yml`, 'utf8');
  assert.match(config, /^blank_issues_enabled: (true|false)$/m);
  const links = [...config.matchAll(/url: https:\/\/github\.com\/ThanhNguyxnOrg\/\.github\/blob\/main\/(\S+)/g)];
  assert.ok(links.length > 0, 'no contact links');
  for (const [, path] of links) assert.ok(fs.existsSync(path), path);
});
