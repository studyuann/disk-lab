// push.js
// Push to GitHub using isomorphic-git and Personal Access Token (PAT)

const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs');
const readline = require('readline');

async function main() {
  let token = process.argv[2] || process.env.GITHUB_TOKEN;

  if (!token) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    token = await new Promise(resolve => {
      rl.question('GitHub Personal Access Token (PAT)을 입력하세요: ', answer => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  if (!token) {
    console.error('오류: GitHub 토큰이 입력되지 않았습니다.');
    console.log('토큰 발급 주소: https://github.com/settings/tokens (classic -> repo 권한 선택)');
    process.exit(1);
  }

  console.log('[1/2] GitHub 원격 저장소(origin/main)로 푸시를 시작합니다...');
  try {
    const pushResult = await git.push({
      fs,
      http,
      dir: '.',
      remote: 'origin',
      ref: 'main',
      force: false,
      onAuth: () => ({ username: token })
    });

    console.log('[2/2] 푸시 완료! 성공적으로 반영되었습니다.');
    console.log('확인 주소: https://github.com/studyuann/disk-lab');
  } catch (err) {
    console.error('\n푸시 실패:', err.message);
    if (err.message.includes('401') || err.message.includes('Unauthorized')) {
      console.error('인증 실패: 토큰에 "repo" (저장소 쓰기) 권한이 있는지 확인해주세요.');
    }
  }
}

main();
