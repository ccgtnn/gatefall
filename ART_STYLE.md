# Gatefall · Библия стиля карт

## Визуальный язык

Все иллюстрации выглядят как кадры одного научно-фантастического мира. Объём читается по контровому свету и лёгкой дымке. Металл, камень и органика сохраняют узнаваемые фактуры. У главного объекта один хорошо читаемый силуэт и одно яркое пятно в центре. Держим фон тёмным, с различимыми деталями.

| Фракция | Свет и акценты | Материалы |
| --- | --- | --- |
| Протекторат | Холодный стальной синий, редкие оранжевые огни | Слоистые плиты, индустриальная сталь, мокрый бетон |
| Поросль | Кислотно-зелёное внутреннее свечение, фиолетовый контровой свет | Полупрозрачные мембраны, минеральная кора, волокнистая органика |

## Единый шаблон

Образец рисованного стиля для всех новых карт — Гнилой исполин.

Основной блок остаётся одинаковым. В `[CARD]` добавьте объект, одно действие или позу, окружение, материалы, палитру фракции и положение светового акцента. По возможности используйте утверждённую вертикальную иллюстрацию той же фракции как референс.

```text
Painterly digital illustration in the style of high-end card game art: visible confident brushwork, simplified clean shapes, less micro-detail and noise, strong readable silhouette, hand-painted feel, not photorealistic, not comic or cartoon.
Gatefall original science-fiction card illustration, single full-bleed portrait 2:3 image. Atmospheric lighting, tactile materials, subtle volumetric haze, crisp silhouette, a readable light focal patch at the geometric center and cool rim light. A large single subject fills the frame, all essential recognition features in the central 55% to survive a center crop. Dark slate, blue mist or aubergine shadows with visible details, not black void. Rich but controlled contrast. No text, frame, card markings, watermark, collage, gore or recognizably existing game/franchise designs. The supplied reference is for the approved Gatefall artwork; output a single illustration.

[CARD]
```

Ниже собраны подстановки для иллюстрированных карт.

### Тяжёлый штурмовик

Use only the top-left dark reference panel for atmosphere and original armor identity. Create a portrait artwork of the Heavy Assault trooper up close, helmet and torso centered, looming at a flooded industrial airlock. Broad asymmetric plates of chipped brushed steel, rectangular visor with a thin orange status light, blue fog and bright cold light behind the shoulder. Industrial pressure armor with slab-like plates, a single distant orange guide lamp, damp steel and water. No real-world firearm focus, readable central armor silhouette.

### Бастион «Рубеж»

Use only the top-left dark reference panel as light and color reference. Depict Bastion Rubezh itself, a standalone armored wall-fortification unit guarding an ancient gate, huge hexagonal compression plates and one central orange reactor slit, anchored to the wet rock by splayed supports. Towering wedge silhouette with an illuminated cold-blue atmospheric opening behind it. Low angle, giant scale, panoramic cues confined to the margins, central geometry very clear. Steel grey, cold cobalt and sparse orange lights.

### Кокон

Use the vertical original cocoon reference for the exact asset identity and atmosphere. Create the production card image of that same large translucent crystalline tendril cocoon, centered and filling the frame: sharp swept violet ribs, green membranes, a curled larval silhouette in its brilliant chartreuse heart. Pull the core slightly forward and brighten the blue-violet rim so the seedlike shape is instantly readable at thumbnail size. Surround it by textured cavern rock and ground haze.

### Колосс

Use the vertical cocoon as the Pоrosl faction material, color and lighting reference. Create a very distinct giant grown siege organism called Colossus. From a low angle, the central wedge-shaped head and broad chest tower above the viewer. Thick overlapping violet basalt-bark lamellae, two wet massive forelimbs framing the lower image, a single intense acid-green internal seam in its central sternum, and visible cool lavender backlight. Dark misty crevasse, with acid glow reflecting off ribbed organic surfaces. Mineral and botanical anatomy, asymmetrical silhouette and no recognizable insectoid franchise anatomy.

### Орбитальный залп

Orbital Salvo, a tactical Effect for the Protectorate. A single original armored orbital strike platform, twin offset steel prongs joined by a heavy transverse spine, seen in a low diagonal angle above a blue planet. A single concentrated amber-white energy beam is fired into distant empty cloud layers. Show the central orange-white emitter and a short span of its beam around the geometric center, framed by industrial steel and the cool curve of the planet. Blue-grey hard sci-fi pressure hull, carved dark metal and believable reflections. Bright at center, readable in 50 pixel crop. Large foreground platform, no spacecraft squadron, no people, no details of targeting or weapon construction.

### Генератор щита

Shield Generator, a compact deployable Protectorate artifact with a distinct, clearly mechanical outline. A squat field generator with a round coil nested between three heavy steel fins, mounted on a low triangular chassis on wet stone. A luminous blue field arcs outward like a partial transparent dome and brushes its top. One small amber latch of light anchors the center next to the icy coil. Brushed cobalt-grey pressure plates and rain mist. Tightly framed, readable blue arcs and ring in the center. Distinct from a fortress or spacecraft, no troops or weapons.

### Инкубатор

Incubator, a Growth artifact built by the alien organism rather than by humans. A hollow branching column of violet mineral roots cradles three stacked oblong translucent green hatch chambers linked by thick dark purple tendons. One open hatch at center spills chartreuse light from within, the other chambers form a distinct tiered rhythm. Twisted volcanic cavern, cool violet rim light, condensation, no figures or gore. A rooted structure with several chambers, visually distinct from the single teardrop Cocoon in the reference; focus on the central open hatch.

### Кислотный плевун

Acid Spitter, a small mobile Growth organism. Frame the head in profile, with clearly separated wedge-shaped jaws in layered violet mineral armor. An acid-green jet crosses the center from the open mouth. Blue fog and pale violet rim light outline the teeth and jaw.

## Проверка в игре

- Исходник вертикальный, 2:3. В центральной части кадра должны оставаться узнаваемые детали и световое пятно при кропе до размеров маленькой карты.
- Сравнивайте центральные кропы карт одной фракции рядом. У Поросли роль передаёт анатомия, у бойцов Протектората — поза и снаряжение. Свечение подчёркивает эти отличия.
- Сначала смотрим на силу, броню и силуэт на малой карте. Фон и детали иллюстрации читаем в крупном просмотре.
- Экспорт для игры — WebP 480 × 720. Маленькая карта показывает центральный кроп, крупная — полный кадр. Иллюстрации лежат в [docs/art](docs/art).
