from musecam.input import InputManager
from musecam.models import Action


def make_input_manager() -> InputManager:
    manager = InputManager.__new__(InputManager)
    manager._width = 480
    manager._height = 320
    manager._touch_x = 750
    manager._touch_y = 250
    manager._touch_x_range = (0, 1_000)
    manager._touch_y_range = (0, 500)
    manager._touch_swap_xy = False
    manager._touch_invert_x = False
    manager._touch_invert_y = False
    return manager


def test_touch_scaling_and_control_regions() -> None:
    manager = make_input_manager()
    assert manager._scaled_touch_position() == (359, 160)
    assert manager._touch_action(40, 300) == Action.PREVIOUS
    assert manager._touch_action(180, 300) == Action.SHUTTER
    assert manager._touch_action(300, 300) == Action.NEXT
    assert manager._touch_action(440, 300) == Action.SHARE
    assert manager._touch_action(200, 100) == Action.SHUTTER


def test_swapped_and_inverted_touch_axes() -> None:
    manager = make_input_manager()
    manager._touch_swap_xy = True
    manager._touch_invert_x = True
    manager._touch_invert_y = True
    assert manager._scaled_touch_position() == (239, 80)


def test_empty_nonblocking_touch_read() -> None:
    class TouchDevice:
        def read(self):
            def events():
                raise BlockingIOError
                yield

            return events()

    manager = make_input_manager()
    manager._touch_device = TouchDevice()
    manager._touch_ecodes = object()

    assert manager._poll_touchscreen() == []
