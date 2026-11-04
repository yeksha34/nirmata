<!-- The image model has never seen this item. In <prompt>, describe it so it can be drawn from the words alone:
     shape, size, colour, material, surface, count, how it hangs or sits. Never rely on the name.
     <reference> (optional): a world-relative path to an image you made; it guides the render. -->
<!-- Only make an object a card when a character interacts with it AND the world customises it
     so a generic prompt would fail. Link to characters (owners) and/or CGs. -->
<!-- type: held | furniture | tool | mount | fixture -->
<card id="object.example" kind="object" name="Example Object" owners="char.example" cgs="" type="held">
  <summary>What it is in one line.</summary>
  <appearance>Shape, material, colour, scale.</appearance>
  <interaction>How a character uses it on screen.</interaction>
  <why-custom>Why a generic prompt cannot draw it.</why-custom>
  <prompt>Shape, size, colour, material and state of the object.</prompt>
  <reference></reference>
</card>
