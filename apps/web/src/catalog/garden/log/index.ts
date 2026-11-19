import { colorParam, cylinder, dimension, numberParam, shade, tilted } from '../../parts';
import { definePiece } from '../../types';
import { sizeOf } from '../../furniture/size';

const CUT = '#c9ad84';

/** A tree trunk section lying along its width, with the light cut wood at both ends. */
export default definePiece({
  id: 'garden.log',
  parts: (values) => {
    const { width: length } = sizeOf(values);
    const diameter = numberParam(values, 'diameter');
    const bark = colorParam(values, 'color');
    // Upright cylinders, tilted onto their side (along z) and turned to lie along x.
    const lying = (x: number, len: number, color: string) => ({
      ...tilted(cylinder([x, diameter / 2, 0], diameter, len, color, 'body'), Math.PI / 2),
      rotationY: Math.PI / 2,
    });
    return [
      lying(0, length - 0.02, bark),
      lying(-length / 2 + 0.005, 0.01, shade(CUT, -0.05)),
      lying(length / 2 - 0.005, 0.01, CUT),
    ];
  },
  dimensions: (values) => {
    const { width: length } = sizeOf(values);
    const diameter = numberParam(values, 'diameter');
    return [
      dimension([-length / 2, 0, diameter / 2], [length / 2, 0, diameter / 2], length, 'Length'),
      dimension([length / 2, 0, 0], [length / 2, diameter, 0], diameter, 'Diameter'),
    ];
  },
});
