// git_manager.js
// Git management script using isomorphic-git

const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname);

async function initAndCommit() {
  console.log('[1/4] Git 저장소 초기화 중...');
  await git.init({ fs, dir, defaultBranch: 'main' });

  console.log('[2/4] 원격 저장소(origin) 설정: https://github.com/studyuann/disk-lab');
  try {
    await git.addRemote({
      fs,
      dir,
      remote: 'origin',
      url: 'https://github.com/studyuann/disk-lab.git',
      force: true
    });
  } catch (e) {
    // remote already exists
  }

  console.log('[3/4] 파일 스테이징(git add) 중...');
  const filesToTrack = [
    '.gitignore',
    'package.json',
    'package-lock.json',
    'README.md',
    'server.js',
    'scan.js',
    'ai_parser.js',
    'text_parser.js',
    'excel_generator.js',
    '실행하기.bat',
    'public/index.html',
    'sample_images/sample_crystaldiskinfo.jpg',
    '디스크관리대장.xlsx'
  ];

  for (const file of filesToTrack) {
    if (fs.existsSync(path.join(dir, file))) {
      await git.add({ fs, dir, filepath: file });
    }
  }

  console.log('[4/4] 커밋 생성 중...');
  const sha = await git.commit({
    fs,
    dir,
    author: {
      name: 'studyuann',
      email: 'studyuann@users.noreply.github.com'
    },
    message: 'feat: Initial commit - CrystalDiskInfo to Excel Disk Ledger'
  });

  console.log(`[완료] 커밋 생성 완료! (SHA: ${sha.substring(0, 7)})`);
  console.log(`[원격지] https://github.com/studyuann/disk-lab.git (main branch)`);
}

initAndCommit().catch(err => {
  console.error('[오류 발생]:', err);
});
