// Renders the app background. If a custom wallpaper/background image is set
// on the current store it is used (cover, fixed behind everything); otherwise
// the default decorative forest scene is shown.
import ForestBackground from './ForestBackground';

export default function AppBackground({ image }) {
  if (image) {
    return (
      <div
        className="fixed inset-0 -z-10 pointer-events-none bg-cover bg-center"
        style={{ backgroundImage: `url("${image}")` }}
        aria-hidden="true"
      />
    );
  }
  return <ForestBackground />;
}
