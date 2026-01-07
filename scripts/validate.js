#!/usr/bin/env node

// 发布前验证脚本
const path = require('path');
const fs = require('fs-extra');

async function validate() {
  const templatesDir = path.join(__dirname, '..', 'templates');
  const required = ['commands'];
  const errors = [];

  console.log('[validate] 检查发布前置条件...\n');

  for (const dir of required) {
    const dirPath = path.join(templatesDir, dir);
    if (!(await fs.pathExists(dirPath))) {
      errors.push(`templates/${dir} 目录不存在`);
    } else {
      const files = await fs.readdir(dirPath);
      if (files.length === 0) {
        errors.push(`templates/${dir} 目录为空`);
      } else {
        console.log(`  ✅ templates/${dir}: ${files.length} 个文件`);
      }
    }
  }

  if (errors.length > 0) {
    console.log('\n❌ 验证失败:\n');
    errors.forEach(e => console.log(`  - ${e}`));
    process.exit(1);
  }

  console.log('\n✅ 验证通过，可以发布\n');
}

validate();
