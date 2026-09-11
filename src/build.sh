#!/usr/bin/env bash
# 해루낚 — 소스에서 사이트를 만든다.
#
# 이 폴더(src/)의 소스로 저장소 루트의 index.html 과 spot/·tide/·species/ 등 정적 페이지를 만든다.
# 깃허브 액션(.github/workflows/build.yml)이 src/ 가 바뀔 때마다 이 파일을 돌리고 결과를 커밋한다.
# 손으로 돌릴 때도 같다:  bash src/build.sh
#
# 빌드 스크립트들은 「저장소 루트가 ghup/ 이라는 이름으로 옆에 있다」고 가정하고 쓰였다.
# 그래서 src/ 안에 ghup → .. 바로가기를 걸어 두고 그 안에서 돌린다.
set -euo pipefail
cd "$(dirname "$0")"
[ -e ghup ] || ln -s .. ghup

node extract_data.js
node build_standalone.js
cp 해루낚_미리보기.html ../index.html
node build_atlas.js
node build_tide.js          # 마지막 — atlas 가 sitemap 을 새로 쓰고 tide 가 거기에 덧붙인다

# 부산물은 남기지 않는다 (.gitignore 에도 적어 두었지만 깨끗이)
rm -f 해루낚_미리보기.html artifact.html atlas_data.json
echo "빌드 끝 — index.html $(du -k ../index.html | cut -f1)KB"
