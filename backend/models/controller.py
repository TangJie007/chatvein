"""HTTP 路由（NestJS Controller 对应物）。"""

from fastapi import APIRouter, HTTPException

from .entity import CreateLlmModelDto, UpdateLlmModelDto
from .service import ModelsService

models_controller = APIRouter()
_service = ModelsService()


@models_controller.get("/")
def list_models():
    return {"models": _service.list_models()}


@models_controller.get("/{model_id}")
def get_model(model_id: str):
    model = _service.get_model(model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="模型不存在")
    return model


@models_controller.post("/", status_code=201)
def create_model(payload: CreateLlmModelDto):
    return _service.create_model(payload)


@models_controller.patch("/{model_id}")
def update_model(model_id: str, payload: UpdateLlmModelDto):
    model = _service.update_model(model_id, payload)
    if model is None:
        raise HTTPException(status_code=404, detail="模型不存在")
    return model


@models_controller.delete("/{model_id}")
def delete_model(model_id: str):
    try:
        deleted = _service.delete_model(model_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="模型不存在")
    return {"deleted": 1, "id": model_id}


@models_controller.post("/{model_id}/default")
def set_default_model(model_id: str):
    model = _service.set_default(model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="模型不存在")
    return model


@models_controller.post("/{model_id}/test")
def test_model_connection(model_id: str):
    result = _service.test_connection(model_id)
    if result is None:
        raise HTTPException(status_code=404, detail="模型不存在")
    return result
