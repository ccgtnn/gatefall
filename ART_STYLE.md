# Gatefall · Библия стиля карт

## Визуальный язык

Все иллюстрации выглядят как кадры одного научно-фантастического мира. Объём читается по контровому свету и лёгкой дымке. Металл, камень и органика сохраняют узнаваемые фактуры. У главного объекта один хорошо читаемый силуэт и одно яркое пятно в центре. Держим фон тёмным, с различимыми деталями.

| Фракция | Свет и акценты | Материалы |
| --- | --- | --- |
| Протекторат | Холодный стальной синий, редкие оранжевые огни | Слоистые плиты, индустриальная сталь, мокрый бетон |
| Поросль | Кислотно-зелёное внутреннее свечение, фиолетовый контровой свет | Полупрозрачные мембраны, минеральная кора, волокнистая органика |

## Единый шаблон

Основной блок остаётся одинаковым. В `[CARD]` добавьте объект, одно действие или позу, окружение, материалы, палитру фракции и положение светового акцента. По возможности используйте утверждённую вертикальную иллюстрацию той же фракции как референс.

```text
Gatefall original science-fiction card illustration, single full-bleed portrait 2:3 image. Cinematic atmospheric realism, tactile materials, subtle volumetric haze, crisp silhouette, a readable light focal patch at the geometric center and cool rim light. A large single subject fills the frame, all essential recognition features in the central 55% to survive a center crop. Dark slate, blue mist or aubergine shadows with visible details, not black void. Rich but controlled contrast. No text, frame, card markings, watermark, collage, gore or recognizably existing game/franchise designs. The supplied reference is for the approved Gatefall artwork; output a single illustration.

[CARD]
```

Для прототипа четыре первых подстановки описаны ниже.

### Тяжёлый штурмовик

Use only the top-left dark reference panel for atmosphere and original armor identity. Create a portrait artwork of the Heavy Assault trooper up close, helmet and torso centered, looming at a flooded industrial airlock. Broad asymmetric plates of chipped brushed steel, rectangular visor with a thin orange status light, blue fog and bright cold light behind the shoulder. Industrial pressure armor with slab-like plates, a single distant orange guide lamp, damp steel and water. No real-world firearm focus, readable central armor silhouette.

### Бастион «Рубеж»

Use only the top-left dark reference panel as light and color reference. Depict Bastion Rubezh itself, a standalone armored wall-fortification unit guarding an ancient gate, huge hexagonal compression plates and one central orange reactor slit, anchored to the wet rock by splayed supports. Towering wedge silhouette with an illuminated cold-blue atmospheric opening behind it. Low angle, giant scale, panoramic cues confined to the margins, central geometry very clear. Steel grey, cold cobalt and sparse orange lights.

### Кокон

Use the vertical original cocoon reference for the exact asset identity and atmosphere. Create the production card image of that same large translucent crystalline tendril cocoon, centered and filling the frame: sharp swept violet ribs, green membranes, a curled larval silhouette in its brilliant chartreuse heart. Pull the core slightly forward and brighten the blue-violet rim so the seedlike shape is instantly readable at thumbnail size. Surround it by textured cavern rock and ground haze.

### Колосс

Use the vertical cocoon as the Pоrosl faction material, color and lighting reference. Create a very distinct giant grown siege organism called Colossus. From a low angle, the central wedge-shaped head and broad chest tower above the viewer. Thick overlapping violet basalt-bark lamellae, two wet massive forelimbs framing the lower image, a single intense acid-green internal seam in its central sternum, and visible cool lavender backlight. Dark misty crevasse, with acid glow reflecting off ribbed organic surfaces. Mineral and botanical anatomy, asymmetrical silhouette and no recognizable insectoid franchise anatomy.

## Проверка в игре

- Исходник вертикальный, 2:3. В центральной части кадра должны оставаться узнаваемые детали и световое пятно при кропе до размеров маленькой карты.
- Сначала смотрим на силу, броню и силуэт на малой карте. Фон и детали иллюстрации читаем в крупном просмотре.
- Экспорт для игры — WebP 480 × 720. Маленькая карта показывает центральный кроп, крупная — полный кадр. Иллюстрации лежат в [docs/art](docs/art).
