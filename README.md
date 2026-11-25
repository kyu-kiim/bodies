# bodies
for graduation

## Boids Simulation

PixiJS 기반 2D 군집(flocking) 시뮬레이션. 원작: [cubeDhuang/boids](https://github.com/cubeDhuang/boids)

## 배포
`main` 브랜치에 푸시하면 GitHub Actions가 GitHub Pages로 자동 배포합니다.
저장소 Settings → Pages → Source를 **GitHub Actions**로 한 번 설정하세요.

사이트 주소: https://kyu-kiim.github.io/bodies/

## Spread Wing (3D, Three.js)
책 스프레드(280 × 220mm)가 중앙 접지선을 축으로 날개처럼 접히고 펼쳐지는 WebGL 실험.
현재 단계: 개체 1개, 제자리 날갯짓만. `H` UI 숨기기 · `F` 전체 화면.

주소: https://kyu-kiim.github.io/bodies/spread/

## Spread Flock (3D Boids)
스프레드 개체들이 Craig Reynolds의 Boids(분리·정렬·응집)로 군집 비행. 마우스를 따라감
(6초간 움직임이 없으면 공간을 천천히 순회). 앞면 이미지 타입 A–F를 개체마다 나눠 적용.
InstancedMesh + 커스텀 버텍스 셰이더(개체별 접힘), Texture Array, 공간 해시 이웃 탐색.

주소: https://kyu-kiim.github.io/bodies/flock/
