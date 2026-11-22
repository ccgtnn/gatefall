// Foundation centers and sizes as artwork percentages, from farthest to nearest.
export const BASE_POSITIONS = [
  [52.8, 51.9, 12, 4.3], [68.8, 56.3, 20, 7.2], [37, 57.1, 20, 7.2],
  [58.8, 62.2, 15, 6.3], [77, 67.8, 23, 9.8], [27.4, 71.5, 25, 11.3],
];

const artworkWidth = 1536;
const artworkHeight = 858;
const foundationLeft = Math.min(...BASE_POSITIONS.map(([x, , width]) => x - width / 2)) / 100;
const foundationRight = Math.max(...BASE_POSITIONS.map(([x, , width]) => x + width / 2)) / 100;
const foundationBottom = Math.max(...BASE_POSITIONS.map(([, y, , height]) => y + height / 2)) / 100;

function coverOffset(viewport, artwork, preferred) {
  return Math.max(Math.min(0, viewport - artwork), Math.min(0, preferred));
}

export function baseLayout(viewportWidth, viewportHeight) {
  const scale = Math.max(viewportWidth / artworkWidth, viewportHeight / artworkHeight);
  const width = artworkWidth * scale;
  const height = artworkHeight * scale;
  const left = coverOffset(viewportWidth, width,
    (viewportWidth - width * (foundationLeft + foundationRight)) / 2);
  // Leave room for the gates above the foundations whenever the crop allows it.
  const top = coverOffset(viewportHeight, height,
    Math.min((viewportHeight - height) / 4, viewportHeight - foundationBottom * height));
  return { width, height, left, top };
}
