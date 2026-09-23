"""模型配置：密钥只以脱敏形式离开服务层。"""

from models.entity import CreateLlmModelDto
from models.service import ModelsService, mask_api_key


def test_mask_api_key() -> None:
    assert mask_api_key(None) is None
    assert mask_api_key("") is None
    assert mask_api_key("abcd") == "****cd"
    masked = mask_api_key("sk-test-secret-key")
    assert masked is not None
    assert masked != "sk-test-secret-key"
    assert "*" in masked
    assert masked.startswith("sk-tes")
    assert masked.endswith("-key")


def test_create_model_does_not_return_raw_key() -> None:
    created = ModelsService().create_model(
        CreateLlmModelDto(
            name="本地",
            model_id="gpt-test",
            api_key="sk-test-secret-key",
        )
    )
    assert created.has_api_key is True
    assert created.key_mask != "sk-test-secret-key"
    assert "secret" not in (created.key_mask or "")
