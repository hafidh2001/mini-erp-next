import { WarnFull } from "@/components/app/warn-full";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useModel } from "@/hooks/use-model";
import { useModelDetail } from "@/hooks/use-model-detail";
import { FC } from "react";
import { ModelName, Models } from "shared/types";
import { Fields } from "system/model/layout/types";
import { MDetailTabs } from "./detail-tabs";
import { DetailForm } from "./form";

export const MDetail: FC<{ modelName: ModelName }> = ({ modelName }) => {
  const model = useModel({ modelName });
  const detail = useModelDetail({ model });
  if (!model.ready || detail.loading)
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner />
      </div>
    );

  if (!model.instance || !detail.current) {
    return (
      <WarnFull>
        Tampilan secara tabel <br />
        tidak tersedia
      </WarnFull>
    );
  }

  return (
    <>
      <div className="rounded-md border bg-white">
        <MDetailTabs model={model.instance} detail={detail.current}>
          {({ activeTab }) => {
            if (
              activeTab.type === "default" &&
              model.instance &&
              detail.current
            ) {
              return (
                <DetailForm
                  model={model.instance}
                  fields={detail.current.fields}
                  data={detail.data}
                />
              );
            }
          }}
        </MDetailTabs>
      </div>
    </>
  );
};
